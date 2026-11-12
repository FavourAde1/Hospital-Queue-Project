const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { Physician } = require('../models');

const PUBLIC_ROOM = 'public';
const physicianRoom = (id) => `physician:${id}`;
let io = null;

function init(httpServer) {
  io = new Server(httpServer, { cors: { origin: config.corsOrigins } });
  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next();
    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      if (payload.role !== 'physician' || !payload.sub) throw new Error('wrong role');
      const physician = await Physician.findOne({ _id: payload.sub, active: true }).select('_id').lean();
      if (!physician) throw new Error('inactive');
      socket.data.physicianId = String(physician._id);
      socket.data.tokenExpiresAt = payload.exp ? payload.exp * 1000 : null;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(PUBLIC_ROOM);
    if (socket.data.physicianId) {
      socket.join(physicianRoom(socket.data.physicianId));
      if (socket.data.tokenExpiresAt) {
        const delay = Math.max(0, socket.data.tokenExpiresAt - Date.now());
        const expiryTimer = setTimeout(() => socket.disconnect(true), delay);
        expiryTimer.unref();
        socket.on('disconnect', () => clearTimeout(expiryTimer));
      }
    }
    socket.on('join:public', () => socket.join(PUBLIC_ROOM));
  });
  return io;
}

function emitPublic(event, payload) { if (io) io.to(PUBLIC_ROOM).emit(event, payload); }
function emitPhysician(physicianId, event, payload) { if (io) io.to(physicianRoom(physicianId)).emit(event, payload); }
function revokePhysician(physicianId) { if (io) io.in(physicianRoom(physicianId)).disconnectSockets(true); }
function close() { return io ? new Promise((resolve) => io.close(resolve)) : Promise.resolve(); }

module.exports = { init, emitPublic, emitPhysician, revokePhysician, close };
