const config = require('../config');
const crypto = require('crypto');
const realtime = require('./realtime');
const { Physician, Patient, Ticket, Counter } = require('../models');
const { PHYSICIAN_FIELDS, ACTIVE, toPhysician, currentQueueDate } = require('./queueService');
const { HttpError } = require('../utils/httpError');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { formatTicketNumber } = require('../utils/ticketNumber');
const { averageConsultMinutes } = require('../utils/stats');

/**
 * Where a ticket stands in its physician's queue.
 * position: 1 = next to be called, 0 = being seen now, null = no longer in the queue.
 * estimatedWaitMinutes is a rough guess: patients ahead x average consultation so far today
 * (the physician's current patient counts as half a consultation).
 */
async function queueInfo(ticket, physicianStatus) {
  if (ticket.status === 'CALLED') return { position: 0, estimatedWaitMinutes: 0 };
  if (ticket.status !== 'WAITING') return { position: null, estimatedWaitMinutes: null };

  const base = { physicianId: ticket.physicianId, queueDate: ticket.queueDate, status: 'WAITING' };
  const [urgentAhead, normalAhead, completed] = await Promise.all([
    Ticket.countDocuments({
      ...base,
      priority: 'URGENT',
      ...(ticket.priority === 'URGENT' ? { sequence: { $lt: ticket.sequence } } : {}),
    }),
    ticket.priority === 'NORMAL'
      ? Ticket.countDocuments({ ...base, priority: 'NORMAL', sequence: { $lt: ticket.sequence } })
      : 0,
    Ticket.find({ physicianId: ticket.physicianId, queueDate: ticket.queueDate, status: 'COMPLETED' })
      .sort({ completedAt: -1 })
      .limit(20)
      .select('calledAt completedAt')
      .lean(),
  ]);

  const ahead = urgentAhead + normalAhead;
  const average = averageConsultMinutes(completed, config.defaultConsultMinutes);
  const busy = physicianStatus === 'OCCUPIED' ? 0.5 : 0;

  return { position: ahead + 1, estimatedWaitMinutes: Math.round((ahead + busy) * average) };
}

// Patient-facing view. Deliberately has no patient name or phone: ticket numbers are short and guessable.
function shapePatientTicket(ticket, physician, info) {
  return {
    id: String(ticket._id),
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    priority: ticket.priority,
    queueDate: ticket.queueDate,
    createdAt: ticket.createdAt,
    calledAt: ticket.calledAt || null,
    completedAt: ticket.completedAt || null,
    position: info.position,
    estimatedWaitMinutes: info.estimatedWaitMinutes,
    physician,
  };
}

// Two requests can race on the very first ticket of the day (both try to create the day's counter);
// MongoDB rejects one with a duplicate-key error and a second attempt succeeds.
async function withRetryOnDuplicate(fn, attempts = 3) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (isDuplicateKey(err) && err.keyPattern && err.keyPattern.activeKey) throw err;
      if (isDuplicateKey(err) && i < attempts) continue;
      throw err;
    }
  }
}

/**
 * Take a ticket for a chosen physician: assigns the next number (A-001, A-002, ...) and stamps date and time.
 * `priority` is only ever URGENT when reception creates the ticket through the admin API.
 */
async function createTicket({ patientName, phone, physicianId, priority = 'NORMAL' }) {
  const queueDate = currentQueueDate();

  const physician = await Physician.findOne({ _id: physicianId, active: true }).select(PHYSICIAN_FIELDS).lean();
  if (!physician) throw new HttpError(404, 'Physician not found');

  // Normalize identity and let MongoDB enforce one patient identity per name + phone.
  // Patients without a phone are intentionally not deduplicated: names alone are not reliable identifiers.
  const normalizedName = patientName.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  const identityKey = phone
    ? crypto.createHash('sha256').update(`${normalizedName}|${phone}`).digest('hex')
    : null;
  let patient;
  if (identityKey) {
    // Reuse legacy patient records created before identityKey was introduced.
    patient = await Patient.findOne({ phone, name: patientName }).lean();
    if (patient) {
      if (!patient.identityKey) {
        try { await Patient.updateOne({ _id: patient._id, identityKey: { $exists: false } }, { $set: { identityKey } }); }
        catch (err) { if (!isDuplicateKey(err)) throw err; }
      }
    } else {
      try {
        patient = await Patient.findOneAndUpdate(
          { identityKey },
          { $setOnInsert: { name: patientName, phone, identityKey, createdAt: new Date() } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean();
      } catch (err) {
        // Concurrent upserts can race on the unique identity index; read the winner's document.
        if (!isDuplicateKey(err)) throw err;
        patient = await Patient.findOne({ identityKey }).lean();
        if (!patient) throw err;
      }
    }
  } else {
    patient = await Patient.create({ name: patientName, phone: null });
    patient = patient.toObject();
  }

  const activeKey = `${patient._id}:${physicianId}:${queueDate}`;
  const existing = await Ticket.findOne({
    $or: [
      { activeKey },
      // Compatibility for active tickets created before activeKey was added.
      { patientId: patient._id, physicianId, queueDate, status: { $in: ACTIVE } },
    ],
  }).select('ticketNumber').lean();
  if (existing) {
    throw new HttpError(409, 'This patient already has an active ticket with this physician', {
      ticketNumber: existing.ticketNumber,
    });
  }

  let created;
  try {
    created = await withRetryOnDuplicate(async () => {
      // $inc is atomic. The unique activeKey index also closes the check-then-create race.
      const counter = await Counter.findOneAndUpdate(
        { _id: `${physicianId}:${queueDate}` },
        { $inc: { last: 1 } },
        { new: true, upsert: true },
      ).lean();
      const doc = await Ticket.create({
        ticketNumber: formatTicketNumber(physician.code, counter.last),
        sequence: counter.last,
        queueDate,
        priority,
        patientId: patient._id,
        physicianId,
        activeKey,
      });
      return doc.toObject();
    });
  } catch (err) {
    if (isDuplicateKey(err) && err.keyPattern && err.keyPattern.activeKey) {
      const duplicate = await Ticket.findOne({ activeKey }).select('ticketNumber').lean();
      if (duplicate) {
        throw new HttpError(409, 'This patient already has an active ticket with this physician', {
          ticketNumber: duplicate.ticketNumber,
        });
      }
    }
    throw err;
  }

  const info = await queueInfo(created, physician.status);

  realtime.emitPhysician(physicianId, 'ticket:created', {
    ticketNumber: created.ticketNumber,
    patientName,
    priority: created.priority,
    createdAt: created.createdAt,
  });
  realtime.emitPublic('queue:updated', { physicianId, reason: 'ticket', at: new Date().toISOString() });

  return shapePatientTicket(created, toPhysician(physician), info);
}

/** Look up today's ticket by its number, e.g. "A-007". */
async function getTicketByNumber(ticketNumber) {
  const ticket = await Ticket.findOne({ ticketNumber, queueDate: currentQueueDate() }).lean();
  if (!ticket) throw new HttpError(404, 'Ticket not found for today');
  const physician = await Physician.findById(ticket.physicianId).select(PHYSICIAN_FIELDS).lean();
  return shapePatientTicket(ticket, toPhysician(physician), await queueInfo(ticket, physician.status));
}

/** Staff view of every ticket on a given day (defaults to today), including patient details. */
async function listTicketsByDate(queueDate) {
  const tickets = await Ticket.find({ queueDate }).sort({ physicianId: 1, sequence: 1 }).lean();
  if (tickets.length === 0) return [];

  const physicianIds = [...new Set(tickets.map((t) => String(t.physicianId)))];
  const patientIds = [...new Set(tickets.map((t) => String(t.patientId)))];
  const [physicians, patients] = await Promise.all([
    Physician.find({ _id: { $in: physicianIds } }).select('code name').lean(),
    Patient.find({ _id: { $in: patientIds } }).select('name phone').lean(),
  ]);
  const physicianById = new Map(physicians.map((p) => [String(p._id), { id: String(p._id), name: p.name, code: p.code }]));
  const patientById = new Map(
    patients.map((p) => [String(p._id), { id: String(p._id), name: p.name, phone: p.phone || null }]),
  );

  return tickets.map((t) => ({
    id: String(t._id),
    ticketNumber: t.ticketNumber,
    status: t.status,
    priority: t.priority,
    queueDate: t.queueDate,
    createdAt: t.createdAt,
    calledAt: t.calledAt || null,
    completedAt: t.completedAt || null,
    patient: patientById.get(String(t.patientId)) || null,
    physician: physicianById.get(String(t.physicianId)) || null,
  }));
}

module.exports = { createTicket, getTicketByNumber, listTicketsByDate };
