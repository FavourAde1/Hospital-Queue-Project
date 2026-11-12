const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { Physician } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const v = require('../utils/validate');
const { HttpError } = require('../utils/httpError');
const { requirePhysician } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const queue = require('../services/queueService');

const { toPhysician } = queue;
const router = express.Router();

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const email = v.email(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || password.length > 200) throw new HttpError(400, 'password is required');

    const physician = await Physician.findOne({ email }).lean();
    const passwordOk = await bcrypt.compare(password, physician ? physician.passwordHash : DUMMY_HASH);
    if (!physician || !physician.active || !passwordOk) throw new HttpError(401, 'Invalid email or password');

    const token = jwt.sign({ role: 'physician' }, config.jwtSecret, {
      subject: String(physician._id),
      expiresIn: config.jwtExpiresIn,
      algorithm: 'HS256',
    });
    res.json({ token, physician: toPhysician(physician) });
  }),
);

// Everything below needs a physician token.
router.use(requirePhysician);

router.get('/me', (req, res) => {
  res.json({ physician: req.physician });
});

// My current patient and my waiting list.
router.get(
  '/me/queue',
  asyncHandler(async (req, res) => {
    res.json(await queue.getPhysicianQueue(req.physician.id));
  }),
);

// Call the next patient. Status becomes OCCUPIED.
router.post(
  '/me/call-next',
  asyncHandler(async (req, res) => {
    res.json(await queue.callNext(req.physician.id));
  }),
);

// Finish the current patient. Status becomes FREE.
router.post(
  '/me/complete',
  asyncHandler(async (req, res) => {
    res.json(await queue.completeCurrent(req.physician.id));
  }),
);

// The called patient did not show up. Marks the ticket SKIPPED and status becomes FREE.
router.post(
  '/me/skip',
  asyncHandler(async (req, res) => {
    res.json(await queue.skipCurrent(req.physician.id));
  }),
);

// Manual toggle: { "status": "FREE" | "OCCUPIED" }
router.patch(
  '/me/status',
  asyncHandler(async (req, res) => {
    const status = v.enumValue((req.body || {}).status, 'status', ['FREE', 'OCCUPIED']);
    res.json({ physician: await queue.setStatus(req.physician.id, status) });
  }),
);

module.exports = router;
