const http = require('http');
const config = require('./config');
const db = require('./lib/db');
const { ensureIndexes } = require('./models');
const { createApp } = require('./app');
const realtime = require('./services/realtime');
const queue = require('./services/queueService');
const { connectionFailureMessage } = require('./utils/dbTarget');

const server = http.createServer(createApp());
realtime.init(server);

async function sweepStaleTickets() {
  try {
    const count = await queue.expireStaleTickets();
    if (count > 0) console.log(`Expired ${count} ticket(s) left over from a previous day`);
  } catch (err) {
    console.error('Stale-ticket sweep failed:', err.message);
  }
}

const sweepTimer = setInterval(sweepStaleTickets, 10 * 60 * 1000);
sweepTimer.unref();

async function start() {
  // Without a database the API is useless, so stop with a clear message instead of failing on every request.
  try {
    await db.connect(config.mongodbUri);
  } catch (err) {
    console.error(connectionFailureMessage(err, config.mongodbUri));
    process.exit(1);
  }
  try {
    await ensureIndexes();
  } catch (err) {
    console.error(`Could not create the database indexes: ${err.message}`);
    process.exit(1);
  }

  server.listen(config.port, () => {
    console.log(`Hospital queue API listening on http://localhost:${config.port}`);
    console.log(`Public board: http://localhost:${config.port}/board  (time zone: ${config.timezone})`);
    sweepStaleTickets();
  });
}

start();

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  clearInterval(sweepTimer);
  server.close(async () => {
    await realtime.close().catch(() => {});
    await db.disconnect().catch(() => {});
    process.exit(0);
  });
  // Do not hang forever on open websocket connections.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
