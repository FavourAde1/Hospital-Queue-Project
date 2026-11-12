// Express 4 does not catch rejected promises from async handlers; this forwards them to the error middleware.
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
