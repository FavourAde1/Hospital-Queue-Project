// Creates demo physicians. Safe to run more than once: existing physicians are updated, never duplicated,
// and an existing physician keeps their password.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/lib/db');
const { Physician, ensureIndexes } = require('../src/models');
const { DEFAULT_MONGODB_URI, connectionFailureMessage } = require('../src/utils/dbTarget');

const DOCTORS = [
  { code: 'A', name: 'Dr. Sarah Smith', email: 'dr.smith@hospital.com', specialty: 'General Medicine', department: 'Outpatient' },
  { code: 'B', name: 'Dr. Michael Jones', email: 'dr.jones@hospital.com', specialty: 'Pediatrics', department: 'Children' },
  { code: 'C', name: 'Dr. Emily Lee', email: 'dr.lee@hospital.com', specialty: 'Cardiology', department: 'Cardiac Care' },
];

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_PASSWORD) {
    throw new Error('Set SEED_PASSWORD before seeding in production; refusing to use the demo password.');
  }

  const uri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;
  try {
    await db.connect(uri);
  } catch (err) {
    console.error(connectionFailureMessage(err, uri));
    process.exitCode = 1;
    return;
  }

  try {
    await ensureIndexes();
    const password = process.env.SEED_PASSWORD || 'doctor123';
    const passwordHash = await bcrypt.hash(password, 10);

    for (const d of DOCTORS) {
      await Physician.updateOne(
        { email: d.email },
        {
          $set: { name: d.name, specialty: d.specialty, department: d.department },
          $setOnInsert: { code: d.code, passwordHash, status: 'FREE', active: true, createdAt: new Date() },
        },
        // Every field is given explicitly above, so Mongoose must not add its own defaults on insert.
        { upsert: true, setDefaultsOnInsert: false },
      );
      console.log(`Physician ready: ${d.code}  ${d.name} <${d.email}>`);
    }
    console.log(
      `Seeded ${DOCTORS.length} physicians. Demo password: ${process.env.SEED_PASSWORD ? '(from SEED_PASSWORD)' : 'doctor123'}`,
    );
  } finally {
    await db.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
