const { HttpError } = require('./httpError');

function bad(message) {
  return new HttpError(400, message);
}

// Required trimmed string with length limits; collapses repeated whitespace.
function str(value, field, { min = 1, max = 100 } = {}) {
  if (typeof value !== 'string') throw bad(`${field} is required`);
  const v = value.trim().replace(/\s+/g, ' ');
  if (v.length < min || v.length > max) throw bad(`${field} must be ${min}-${max} characters`);
  return v;
}

function optionalStr(value, field, opts) {
  if (value === undefined || value === null || value === '') return null;
  return str(value, field, opts);
}

// Accepts "08012345678", "+234 801 234 5678", "0801-234-5678"; returns digits (and leading +) only.
function optionalPhone(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw bad('phone must be a string');
  const v = value.trim();
  if (!/^\+?[0-9][0-9 -]{5,18}[0-9]$/.test(v)) {
    throw bad('phone must be 7-20 digits, optionally starting with +');
  }
  return v.replace(/[ -]/g, '');
}

function email(value) {
  if (typeof value !== 'string') throw bad('email is required');
  const v = value.trim().toLowerCase();
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad('email is not valid');
  return v;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) {
    throw bad('password must be 8-200 characters');
  }
  return value;
}

// MongoDB ObjectId: exactly 24 hex characters. Checked up front so a bad id is a clean 400, not a database error.
function id(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) throw bad(`${field} is not valid`);
  return value;
}

// Case-insensitive match against a list of uppercase values; returns the canonical value.
function enumValue(value, field, allowed) {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!allowed.includes(v)) throw bad(`${field} must be one of: ${allowed.join(', ')}`);
  return v;
}

// Physician ticket prefix: 1-3 letters, stored uppercase.
function code(value) {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z]{1,3}$/.test(v)) throw bad('code must be 1-3 letters');
  return v;
}

// Real calendar date as YYYY-MM-DD.
function dateString(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad(`${field} must be YYYY-MM-DD`);
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    throw bad(`${field} is not a real date`);
  }
  return value;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') throw bad(`${field} must be true or false`);
  return value;
}

module.exports = { str, optionalStr, optionalPhone, email, password, id, enumValue, code, dateString, boolean };
