const express = require('express');
const bcrypt = require('bcryptjs');
const { Physician } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const v = require('../utils/validate');
const { HttpError } = require('../utils/httpError');
const { nextFreeCode } = require('../utils/ticketNumber');
const { requireAdmin } = require('../middleware/auth');
const queue = require('../services/queueService');
const tickets = require('../services/ticketService');
const realtime = require('../services/realtime');
const { Ticket } = require('../models');

const router = express.Router();
router.use(requireAdmin);

const ADMIN_FIELDS = `${queue.PHYSICIAN_FIELDS} email active createdAt`;
const toAdminPhysician = (p) => ({ ...queue.toPhysician(p), email: p.email, active: p.active, createdAt: p.createdAt });

router.get(
  '/physicians',
  asyncHandler(async (req, res) => {
    const docs = await Physician.find({}).sort({ code: 1 }).select(ADMIN_FIELDS).lean();
    res.json({ physicians: docs.map(toAdminPhysician) });
  }),
);

// Add a physician. `code` (1-3 letters, the ticket prefix) is optional; the next free letter is used if omitted.
router.post(
  '/physicians',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const data = {
      name: v.str(body.name, 'name'),
      email: v.email(body.email),
      specialty: v.str(body.specialty, 'specialty'),
      department: v.optionalStr(body.department, 'department'),
    };
    const passwordHash = await bcrypt.hash(v.password(body.password), 10);

    let code = body.code ? v.code(body.code) : null;
    if (!code) {
      const used = (await Physician.find({}).select('code').lean()).map((p) => p.code);
      code = nextFreeCode(used);
      if (!code) throw new HttpError(409, 'All single-letter codes are in use; provide a code of 2-3 letters');
    }

    // A duplicate email or code is rejected by the unique indexes and reported as 409 by the error handler.
    const created = await Physician.create({ ...data, code, passwordHash });
    res.status(201).json({ physician: toAdminPhysician(created.toObject()) });
  }),
);

// Enable or disable a physician: { "active": false }. Disabled physicians cannot log in or receive new tickets.
router.patch(
  '/physicians/:id',
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, 'id');
    const active = v.boolean((req.body || {}).active, 'active');
    const existing = await Physician.findById(id).select('_id active').lean();
    if (!existing) throw new HttpError(404, 'Physician not found');
    if (!active) {
      const outstanding = await Ticket.countDocuments({ physicianId: id, queueDate: queue.currentQueueDate(), status: { $in: ['WAITING', 'CALLED'] } });
      if (outstanding > 0) throw new HttpError(409, 'Cannot deactivate a physician with active queue tickets. Complete, skip or reassign them first.');
    }
    const doc = await Physician.findOneAndUpdate({ _id: id }, { $set: { active } }, { new: true }).select(ADMIN_FIELDS).lean();
    if (!doc) throw new HttpError(404, 'Physician not found');
    if (!active) realtime.revokePhysician(id);
    res.json({ physician: toAdminPhysician(doc) });
  }),
);

// Reception desk: issue a ticket on behalf of a patient, optionally URGENT (jumps ahead of normal tickets).
router.post(
  '/tickets',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const ticket = await tickets.createTicket({
      patientName: v.str(body.patientName, 'patientName', { max: 100 }),
      phone: v.optionalPhone(body.phone),
      physicianId: v.id(body.physicianId, 'physicianId'),
      priority: body.priority === undefined ? 'NORMAL' : v.enumValue(body.priority, 'priority', ['NORMAL', 'URGENT']),
    });
    res.status(201).json({ ticket });
  }),
);

// History / audit: every ticket for a day, with patient details. GET /admin/tickets?date=2026-11-08 (default today).
router.get(
  '/tickets',
  asyncHandler(async (req, res) => {
    const date = req.query.date === undefined ? queue.currentQueueDate() : v.dateString(req.query.date, 'date');
    res.json({ date, tickets: await tickets.listTicketsByDate(date) });
  }),
);

module.exports = router;
