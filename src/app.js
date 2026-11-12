
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const config = require('./config');
const db = require('./lib/db');

const {
  notFound,
  errorHandler
} = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  // Only enable proxy trust when explicitly configured.
  if (config.trustProxy) {
    app.set('trust proxy', config.trustProxy);
  }

  // Security middleware.
  app.use(helmet());

  // CORS configuration.
  app.use(cors({
    origin: config.corsOrigins
  }));

  // JSON request parsing.
  app.use(express.json({
    limit: '10kb'
  }));

  // Health endpoint.
  // Returns HTTP 200 only when MongoDB responds successfully.
  app.get('/health', async (req, res) => {
    try {
      await db.ping();

      return res.status(200).json({
        status: 'ok',
        database: 'connected'
      });

    } catch (error) {
      return res.status(503).json({
        status: 'error',
        database: 'unavailable'
      });
    }
  });

  // Patient routes.
  app.use(
    '/patients',
    require('./routes/patients')
  );

  // Physician routes.
  // Physician login remains POST /physicians/login.
  app.use(
    '/physicians',
    require('./routes/physicians')
  );

  // Queue routes.
  app.use(
    '/queue',
    require('./routes/queue')
  );

  // Administrator routes.
  // Admin authentication is handled by the admin router.
  app.use(
    '/admin',
    require('./routes/admin')
  );

  // Serve the frontend.
  const publicDirectory = path.join(
    __dirname,
    '..',
    'public'
  );

  app.use(express.static(publicDirectory, {
    extensions: ['html'],

    setHeaders(res, filePath) {
      // Prevent stale dashboard JavaScript from being reused.
      if (path.basename(filePath) === 'dashboard.js') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));

  // Unknown routes.
  app.use(notFound);

  // Centralized error handling.
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp
};
