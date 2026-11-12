const mongoose = require('mongoose');

const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const TICKET_STATUSES = ['WAITING', 'CALLED', 'COMPLETED', 'SKIPPED', 'EXPIRED'];

const physicianSchema = new Schema(
  {
    code: { type: String, required: true, unique: true }, // ticket prefix, e.g. "A" -> A-001
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    specialty: { type: String, required: true },
    department: { type: String, default: null },
    status: { type: String, enum: ['FREE', 'OCCUPIED'], default: 'FREE' },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

const patientSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, default: null },
    // SHA-256 of normalized name + phone; unique when a phone is supplied.
    identityKey: { type: String, default: undefined },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
patientSchema.index({ phone: 1 });
patientSchema.index({ identityKey: 1 }, { unique: true, partialFilterExpression: { identityKey: { $type: 'string' } } });

const ticketSchema = new Schema(
  {
    ticketNumber: { type: String, required: true }, // e.g. A-042, restarts each local day per physician
    sequence: { type: Number, required: true }, // numeric part of ticketNumber, defines order within a day
    queueDate: { type: String, required: true }, // YYYY-MM-DD in the hospital's time zone
    status: { type: String, enum: TICKET_STATUSES, default: 'WAITING' },
    // Queue order sorts `priority` descending. "URGENT" sorts after "NORMAL" alphabetically, so urgent
    // tickets come first. Keep that in mind before renaming either value.
    priority: { type: String, enum: ['NORMAL', 'URGENT'], default: 'NORMAL' },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    physicianId: { type: ObjectId, ref: 'Physician', required: true },
    // Present only while WAITING/CALLED; unique per patient, physician and local queue date.
    activeKey: { type: String, default: undefined },
    createdAt: { type: Date, default: Date.now }, // ticket time + date
    calledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { versionKey: false },
);
ticketSchema.index({ physicianId: 1, queueDate: 1, sequence: 1 }, { unique: true });
ticketSchema.index({ queueDate: 1, ticketNumber: 1 }, { unique: true });
ticketSchema.index({ queueDate: 1, status: 1 });
ticketSchema.index({ activeKey: 1 }, { unique: true, partialFilterExpression: { activeKey: { $type: 'string' } }, name: 'one_active_ticket_per_patient_physician_day' });
// The database itself guarantees that a physician never has two patients CALLED at once, even if two
// "call next" requests arrive at the same moment. MongoDB has no row locks, so this index does the job.
ticketSchema.index(
  { physicianId: 1 },
  { unique: true, partialFilterExpression: { status: 'CALLED' }, name: 'one_called_ticket_per_physician' },
);

// One document per physician per day: _id is "<physicianId>:<YYYY-MM-DD>"; `last` is incremented atomically
// to hand out sequence numbers.
// No default on `last`: the first $inc creates it at 1, and a default would clash with that $inc on insert.
const counterSchema = new Schema({ _id: { type: String }, last: { type: Number } }, { versionKey: false });

const Physician = mongoose.model('Physician', physicianSchema);
const Patient = mongoose.model('Patient', patientSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Counter = mongoose.model('Counter', counterSchema);

// Resolves once every index (including the unique ones above) exists. Call it after connecting and before serving.
const ensureIndexes = () => Promise.all([Physician, Patient, Ticket, Counter].map((m) => m.init()));

module.exports = { Physician, Patient, Ticket, Counter, ensureIndexes };
