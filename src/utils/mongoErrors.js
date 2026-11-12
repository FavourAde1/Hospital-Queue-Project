// MongoDB reports a violated unique index as error code 11000 (E11000 duplicate key).
const isDuplicateKey = (err) => Boolean(err && err.code === 11000);

const CONNECTION_ERROR_NAMES = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNotConnectedError',
]);
const isConnectionError = (err) => Boolean(err && CONNECTION_ERROR_NAMES.has(err.name));

module.exports = { isDuplicateKey, isConnectionError };
