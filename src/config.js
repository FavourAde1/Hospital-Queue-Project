require('dotenv').config();
const { DEFAULT_MONGODB_URI } = require('./utils/dbTarget');

function positiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number`);
  return n;
}

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI is required in production. Set it in the environment or .env.');
}
const mongodbUri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required. Copy .env.example to .env and set it.');

// A local-only default keeps the first-run admin dashboard usable; production must configure its own key.
const adminApiKey = process.env.ADMIN_API_KEY || (isProduction ? null : 'dev-admin-key-change-me');

if (isProduction) {
  if (jwtSecret.length < 32 || /change-me/i.test(jwtSecret)) {
    throw new Error('JWT_SECRET must be a random string of at least 32 characters in production.');
  }
  if (adminApiKey && (adminApiKey.length < 16 || /change-me/i.test(adminApiKey))) {
    throw new Error('ADMIN_API_KEY must be a random string of at least 16 characters in production.');
  }
}

const timezone = process.env.HOSPITAL_TIMEZONE || 'Africa/Lagos';
try {
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
} catch {
  throw new Error(`HOSPITAL_TIMEZONE "${timezone}" is not a valid IANA time zone (example: Africa/Lagos).`);
}

const corsRaw = (process.env.CORS_ORIGIN || '*').trim();
const corsOrigins = corsRaw === '*' ? '*' : corsRaw.split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  isProduction,
  mongodbUri,
  port: positiveInt('PORT', 4000),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  adminApiKey,
  timezone,
  defaultConsultMinutes: positiveInt('DEFAULT_CONSULT_MINUTES', 10),
  corsOrigins,
  loginRateLimit: positiveInt('LOGIN_RATE_LIMIT', 10),
  ticketRateLimit: positiveInt('TICKET_RATE_LIMIT', 120),
  trustProxy: process.env.TRUST_PROXY ? positiveInt('TRUST_PROXY', 1) : null,
};
