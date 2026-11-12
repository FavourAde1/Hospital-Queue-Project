const mongoose = require('mongoose');
const { parseMongoTarget, FALLBACK_DB_NAME } = require('../utils/dbTarget');

let listenersRegistered = false;
function registerConnectionLogging() {
  if (listenersRegistered) return;
  listenersRegistered = true;
  mongoose.connection.on('connected', () => console.log('MongoDB connected successfully'));
  mongoose.connection.on('reconnected', () => console.log('MongoDB connection restored'));
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected; the driver will attempt to reconnect'));
  mongoose.connection.on('error', (err) => console.error('MongoDB connection error:', err.message));
}

async function connect(uri) {
  registerConnectionLogging();
  const { db } = parseMongoTarget(uri);
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      socketTimeoutMS: 45000,
      // Explicit IPv4 avoids localhost resolving to ::1 on Windows when mongod binds only to 127.0.0.1.
      family: 4,
      ...(db ? {} : { dbName: FALLBACK_DB_NAME }),
    });
    await mongoose.connection.db.command({ ping: 1 });
  } catch (err) {
    await mongoose.disconnect().catch(() => {});
    throw err;
  }
}

const disconnect = () => mongoose.disconnect();
async function ping() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    const error = new Error('MongoDB is not connected');
    error.name = 'MongooseServerSelectionError';
    throw error;
  }
  await mongoose.connection.db.command({ ping: 1 });
}

module.exports = { connect, disconnect, ping };
