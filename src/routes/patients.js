const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const v = require('../utils/validate');
const { HttpError } = require('../utils/httpError');
const { TICKET_NUMBER_PATTERN } = require('../utils/ticketNumber');
const { ticketLimiter } = require('../middleware/rateLimit');
const queue = require('../services/queueService');
const tickets = require('../services/ticketService');

const router = express.Router();

// Physicians with their FREE / OCCUPIED indicator, who is being served and how many are waiting.
router.get(
  '/physicians',
  asyncHandler(async (req, res) => {
    res.json({ physicians: await queue.getBoard() });
  }),
);

// Take a ticket for a chosen physician.
router.post(
  '/tickets',
  ticketLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const ticket = await tickets.createTicket({
      patientName: v.str(body.patientName, 'patientName', { max: 100 }),
      phone: v.optionalPhone(body.phone),
      physicianId: v.id(body.physicianId, 'physicianId'),
    });
    res.status(201).json({ ticket });
  }),
);

// Check status and position of today's ticket, e.g. GET /patients/tickets/A-007
router.get(
  '/tickets/:ticketNumber',
  asyncHandler(async (req, res) => {
    const ticketNumber = String(req.params.ticketNumber).toUpperCase();
    if (!TICKET_NUMBER_PATTERN.test(ticketNumber)) throw new HttpError(400, 'ticketNumber must look like A-007');
    res.json({ ticket: await tickets.getTicketByNumber(ticketNumber) });
  }),
);

module.exports = router;
