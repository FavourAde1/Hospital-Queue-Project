const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27017/hospital_queue';
const FALLBACK_DB_NAME = 'hospital_queue';

// Pulls the host list and database name out of a MongoDB connection string WITHOUT ever returning
// the user name or password. Anything that does not look like a plain host list / database name is dropped,
// so a malformed string (for example a password containing "/") cannot leak through.
function parseMongoTarget(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/([^/?]*)(?:\/([^?]*))?/.exec(String(uri || ''));
  if (!m) return { hosts: null, db: null };
  const authority = m[1];
  const hostPart = authority.slice(authority.lastIndexOf('@') + 1);
  const hostsOk = /^[A-Za-z0-9.-]+(:\d{1,5})?(,[A-Za-z0-9.-]+(:\d{1,5})?)*$/.test(hostPart);
  const db = m[2] && /^[A-Za-z0-9_-]+$/.test(m[2]) ? m[2] : null;
  return { hosts: hostsOk ? hostPart : null, db };
}

// "127.0.0.1:27017/hospital_queue"
function describeDatabaseTarget(uri) {
  const { hosts, db } = parseMongoTarget(uri);
  if (!hosts) return 'the address in MONGODB_URI';
  return `${hosts}/${db || FALLBACK_DB_NAME}`;
}

// Hides "user:password@" if it ever shows up in a driver message.
function redact(text) {
  return String(text).replace(/(mongodb(?:\+srv)?:\/\/)\S*@/gi, '$1***@');
}

// Short, readable replacement for a raw driver stack trace when MongoDB cannot be reached.
function connectionFailureMessage(err, uri) {
  const reason = redact(String((err && err.message) || err).trim().split('\n')[0]);
  return [
    '',
    `Cannot connect to MongoDB (${describeDatabaseTarget(uri)}).`,
    reason,
    '',
    'To fix:',
    '  - Local MongoDB: make sure it is running (Windows: open the Services app, "MongoDB Server" should say Running).',
    '  - MongoDB Atlas: Network Access must allow your IP address, and the user name and password in MONGODB_URI must be right.',
    '  - No MongoDB yet? See "Database setup" in README.md. After editing .env, restart this command.',
    '',
  ].join('\n');
}

module.exports = { DEFAULT_MONGODB_URI, FALLBACK_DB_NAME, parseMongoTarget, describeDatabaseTarget, connectionFailureMessage };
