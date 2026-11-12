const rateLimit = require('express-rate-limit');
const config = require('../config');

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
  });

// Slows down password guessing.
const loginLimiter = make(15 * 60 * 1000, config.loginRateLimit, 'Too many login attempts. Try again later.');

// Stops one client from flooding the queue with fake tickets. Kiosks share an IP, so the ceiling is high.
const ticketLimiter = make(10 * 60 * 1000, config.ticketRateLimit, 'Too many ticket requests. Please wait a moment.');

module.exports = { loginLimiter, ticketLimiter };
