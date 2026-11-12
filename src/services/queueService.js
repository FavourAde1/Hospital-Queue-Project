const config = require('../config');
const realtime = require('./realtime');
const { Physician, Ticket, Patient } = require('../models');
const { HttpError } = require('../utils/httpError');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { localDate } = require('../utils/time');

const currentQueueDate = () => localDate(new Date(), config.timezone);

const ACTIVE = ['WAITING', 'CALLED'];
const PHYSICIAN_FIELDS = 'code name specialty department status';

const PRIORITY_RANK = { URGENT: 0, NORMAL: 1 };
const byQueueOrder = (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sequence - b.sequence;

// MongoDB sorts "URGENT" after "NORMAL" alphabetically, so descending priority puts urgent tickets first.
const QUEUE_SORT = { priority: -1, sequence: 1 };

// Serialize state transitions per physician inside this single-node deployment. The MongoDB unique
// CALLED-ticket index remains the cross-process safety net for simultaneous call-next requests.
const physicianTails = new Map();
async function withPhysicianLock(physicianId, operation) {
  const key = String(physicianId);
  const previous = physicianTails.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  physicianTails.set(key, current);
  await previous.catch(() => {});
  try { return await operation(); }
  finally {
    release();
    if (physicianTails.get(key) === current) physicianTails.delete(key);
  }
}


const toPhysician = (p) => ({
  id: String(p._id),
  code: p.code,
  name: p.name,
  specialty: p.specialty,
  department: p.department || null,
  status: p.status,
});

// Patients are looked up in one extra query and joined here, instead of populate().
async function loadPatients(tickets) {
  const ids = [...new Set(tickets.map((t) => String(t.patientId)))];
  if (ids.length === 0) return new Map();
  const patients = await Patient.find({ _id: { $in: ids } }).select('name phone').lean();
  return new Map(patients.map((p) => [String(p._id), { id: String(p._id), name: p.name, phone: p.phone || null }]));
}

function shapeTicket(t, patient) {
  return {
    id: String(t._id),
    ticketNumber: t.ticketNumber,
    status: t.status,
    priority: t.priority,
    createdAt: t.createdAt,
    calledAt: t.calledAt || null,
    completedAt: t.completedAt || null,
    ...(patient ? { patient } : {}),
  };
}

/** Public board / physician list: status, who is being served, how many are waiting. */
async function getBoard() {
  const queueDate = currentQueueDate();
  const [physicians, tickets] = await Promise.all([
    Physician.find({ active: true }).sort({ code: 1 }).select(PHYSICIAN_FIELDS).lean(),
    Ticket.find({ queueDate, status: { $in: ACTIVE } }).select('physicianId ticketNumber status priority sequence').lean(),
  ]);

  const byPhysician = new Map();
  for (const t of tickets) {
    const key = String(t.physicianId);
    if (!byPhysician.has(key)) byPhysician.set(key, []);
    byPhysician.get(key).push(t);
  }

  return physicians.map((p) => {
    const view = toPhysician(p);
    const mine = byPhysician.get(view.id) || [];
    const waiting = mine.filter((t) => t.status === 'WAITING').sort(byQueueOrder);
    const serving = mine.find((t) => t.status === 'CALLED');
    return {
      ...view,
      // A physician with a called patient is always shown as OCCUPIED, even if the status write that normally
      // follows "call next" has not landed yet. MongoDB cannot update two documents atomically here.
      status: view.status === 'OCCUPIED' || serving ? 'OCCUPIED' : 'FREE',
      nowServing: serving ? serving.ticketNumber : null,
      waitingCount: waiting.length,
      nextUp: waiting.slice(0, 3).map((t) => t.ticketNumber),
    };
  });
}

/** Physician's own view: the patient currently called plus everyone waiting, in call order. */
async function getPhysicianQueue(physicianId) {
  const queueDate = currentQueueDate();
  const [physician, tickets] = await Promise.all([
    Physician.findById(physicianId).select(PHYSICIAN_FIELDS).lean(),
    Ticket.find({ physicianId, queueDate, status: { $in: ACTIVE } }).lean(),
  ]);
  const patients = await loadPatients(tickets);
  const withPatient = (t) => shapeTicket(t, patients.get(String(t.patientId)));

  const waiting = tickets
    .filter((t) => t.status === 'WAITING')
    .sort(byQueueOrder)
    .map((t, i) => ({ ...withPatient(t), position: i + 1 }));
  const current = tickets.find((t) => t.status === 'CALLED');

  return {
    date: queueDate,
    physician: physician ? toPhysician(physician) : null,
    current: current ? withPatient(current) : null,
    waitingCount: waiting.length,
    waiting,
  };
}

function announce(physician, reason) {
  realtime.emitPublic('physician:status', { physicianId: physician.id, status: physician.status });
  realtime.emitPublic('queue:updated', { physicianId: physician.id, reason, at: new Date().toISOString() });
}

async function updatePhysicianStatus(physicianId, status) {
  const doc = await Physician.findOneAndUpdate({ _id: physicianId }, { $set: { status } }, { new: true })
    .select(PHYSICIAN_FIELDS)
    .lean();
  if (!doc) throw new HttpError(404, 'Physician not found');
  return toPhysician(doc);
}

const ALREADY_SEEING = 'A patient is already with the physician; complete or skip them first';

/**
 * Call the next waiting patient (urgent first, then first come first served). Physician becomes OCCUPIED.
 *
 * No transactions here (a plain local MongoDB does not support them). Two safeguards instead:
 *  1. the ticket is claimed with a conditional update ("only if it is still WAITING"), and
 *  2. a unique index allows at most one CALLED ticket per physician, so a second simultaneous request
 *     is rejected by the database itself.
 */
async function callNextUnlocked(physicianId) {
  const queueDate = currentQueueDate();

  const active = await Ticket.findOne({ physicianId, queueDate, status: 'CALLED' }).select('ticketNumber').lean();
  if (active) {
    throw new HttpError(409, `Complete or skip ticket ${active.ticketNumber} before calling the next patient`);
  }

  let called = null;
  for (let attempt = 0; attempt < 3 && !called; attempt += 1) {
    const next = await Ticket.findOne({ physicianId, queueDate, status: 'WAITING' }).sort(QUEUE_SORT).lean();
    if (!next) throw new HttpError(404, 'No patients are waiting');
    try {
      called = await Ticket.findOneAndUpdate(
        { _id: next._id, status: 'WAITING' },
        { $set: { status: 'CALLED', calledAt: new Date() } },
        { new: true },
      ).lean();
    } catch (err) {
      if (isDuplicateKey(err)) throw new HttpError(409, ALREADY_SEEING);
      throw err;
    }
    // `called` is null when another request claimed that same ticket first: look again.
  }
  if (!called) throw new HttpError(409, 'The queue changed while calling; please try again');

  const physician = await updatePhysicianStatus(physicianId, 'OCCUPIED');
  const patients = await loadPatients([called]);

  realtime.emitPublic('ticket:called', {
    ticketNumber: called.ticketNumber,
    physicianId: physician.id,
    physicianName: physician.name,
    calledAt: called.calledAt,
  });
  announce(physician, 'called');

  return { ticket: shapeTicket(called, patients.get(String(called.patientId))), physician };
}

// Shared by complete / skip: closes the patient currently called and frees the physician.
async function closeCurrentUnlocked(physicianId, finalStatus) {
  // Conditional on status CALLED, so a double click closes the ticket once and the second request gets a 409.
  const closed = await Ticket.findOneAndUpdate(
    { physicianId, queueDate: currentQueueDate(), status: 'CALLED' },
    { $set: { status: finalStatus, completedAt: new Date() }, $unset: { activeKey: 1 } },
    { new: true },
  ).lean();
  if (!closed) throw new HttpError(409, 'No patient is currently called');

  const physician = await updatePhysicianStatus(physicianId, 'FREE');
  const patients = await loadPatients([closed]);

  announce(physician, finalStatus.toLowerCase());
  return { ticket: shapeTicket(closed, patients.get(String(closed.patientId))), physician };
}

const callNext = (physicianId) => withPhysicianLock(physicianId, () => callNextUnlocked(physicianId));
const completeCurrent = (physicianId) => withPhysicianLock(physicianId, () => closeCurrentUnlocked(physicianId, 'COMPLETED'));
const skipCurrent = (physicianId) => withPhysicianLock(physicianId, () => closeCurrentUnlocked(physicianId, 'SKIPPED'));

/** Manual FREE / OCCUPIED toggle (e.g. a break or an emergency). */
async function setStatusUnlocked(physicianId, status) {
  if (status === 'FREE') {
    const active = await Ticket.findOne({ physicianId, queueDate: currentQueueDate(), status: 'CALLED' }).select('ticketNumber').lean();
    if (active) {
      throw new HttpError(409, `Ticket ${active.ticketNumber} is still with the physician; complete or skip it first`);
    }
  }
  const physician = await updatePhysicianStatus(physicianId, status);
  announce(physician, 'status');
  return physician;
}

const setStatus = (physicianId, status) => withPhysicianLock(physicianId, () => setStatusUnlocked(physicianId, status));

/**
 * Tickets left over from a previous day can never be served. Mark them EXPIRED and free any physician
 * who was stuck on one. Runs at startup and on a timer (see server.js).
 */
async function expireStaleTickets() {
  const queueDate = currentQueueDate();
  const stale = await Ticket.find({ queueDate: { $lt: queueDate }, status: { $in: ACTIVE } })
    .select('physicianId status')
    .lean();
  if (stale.length === 0) return 0;

  const stuckPhysicianIds = [...new Set(stale.filter((t) => t.status === 'CALLED').map((t) => String(t.physicianId)))];
  await Ticket.updateMany(
    { _id: { $in: stale.map((t) => t._id) }, status: { $in: ACTIVE } },
    { $set: { status: 'EXPIRED' }, $unset: { activeKey: 1 } },
  );
  if (stuckPhysicianIds.length > 0) {
    const todayCalled = await Ticket.distinct('physicianId', { queueDate, status: 'CALLED', physicianId: { $in: stuckPhysicianIds } });
    await Physician.updateMany({ _id: { $in: stuckPhysicianIds, $nin: todayCalled } }, { $set: { status: 'FREE' } });
  }

  realtime.emitPublic('queue:updated', { reason: 'expired', at: new Date().toISOString() });
  return stale.length;
}

module.exports = {
  currentQueueDate,
  PHYSICIAN_FIELDS,
  ACTIVE,
  toPhysician,
  loadPatients,
  shapeTicket,
  getBoard,
  getPhysicianQueue,
  callNext,
  completeCurrent,
  skipCurrent,
  setStatus,
  expireStaleTickets,
};
