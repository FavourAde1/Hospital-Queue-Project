const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { Physician } = require('../models');
const { PHYSICIAN_FIELDS, toPhysician } = require('../services/queueService');
const { HttpError } = require('../utils/httpError');

/** Physician routes: needs "Authorization: Bearer <token>" from POST /physicians/login. */
async function requirePhysician(req, res, next) {
  try {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Missing bearer token');

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }
    if (payload.role !== 'physician' || !/^[a-f0-9]{24}$/i.test(String(payload.sub))) {
      throw new HttpError(401, 'Invalid or expired token');
    }

    // Checked on every request so a deactivated physician loses access immediately.
    const physician = await Physician.findOne({ _id: payload.sub, active: true }).select(PHYSICIAN_FIELDS).lean();
    if (!physician) throw new HttpError(401, 'Account not found or disabled');

    req.physician = toPhysician(physician);
    return next();
  } catch (err) {
    return next(err);
  }
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

/** Admin routes: needs the "x-admin-key" header to match ADMIN_API_KEY. */
function requireAdmin(req, res, next) {
  if (!config.adminApiKey) {
    return next(new HttpError(503, 'Admin API is disabled. Set ADMIN_API_KEY to enable it.'));
  }
  // Hash both sides so the comparison is constant-time regardless of key length.
  if (!crypto.timingSafeEqual(digest(req.get('x-admin-key') || ''), digest(config.adminApiKey))) {
    return next(new HttpError(401, 'Invalid admin key'));
  }
  return next();
}

module.exports = { requirePhysician, requireAdmin };
