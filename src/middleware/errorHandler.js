const { HttpError } = require('../utils/httpError');
const { isDuplicateKey, isConnectionError } = require('../utils/mongoErrors');

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  // Unique index violated (duplicate email, code, ...)
  if (isDuplicateKey(err)) {
    const field = Object.keys(err.keyPattern || {})[0];
    return res.status(409).json({ error: field ? `A record with the same ${field} already exists` : 'A record with the same unique value already exists' });
  }
  // A malformed id that slipped past validation
  if (err && err.name === 'CastError') return res.status(400).json({ error: 'Invalid id' });
  if (isConnectionError(err)) {
    console.error(err.message);
    return res.status(503).json({ error: 'Database is unavailable. Try again shortly.' });
  }

  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { notFound, errorHandler };
