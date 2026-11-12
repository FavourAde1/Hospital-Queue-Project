// Tests for the pure helpers. They need no database or installed packages: `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');

const { localDate } = require('../src/utils/time');
const { formatTicketNumber, nextFreeCode, TICKET_NUMBER_PATTERN } = require('../src/utils/ticketNumber');
const { averageConsultMinutes } = require('../src/utils/stats');
const v = require('../src/utils/validate');
const { HttpError } = require('../src/utils/httpError');
const { describeDatabaseTarget, connectionFailureMessage } = require('../src/utils/dbTarget');
const { isDuplicateKey, isConnectionError } = require('../src/utils/mongoErrors');

test('localDate follows the hospital time zone, not UTC', () => {
  const lateEveningUtc = new Date('2026-11-08T23:30:00Z');
  assert.equal(localDate(lateEveningUtc, 'UTC'), '2026-11-08');
  assert.equal(localDate(lateEveningUtc, 'Africa/Lagos'), '2026-11-09'); // UTC+1
  assert.equal(localDate(new Date('2026-11-08T00:30:00Z'), 'America/New_York'), '2026-11-07');
});

test('formatTicketNumber pads to three digits and keeps growing past 999', () => {
  assert.equal(formatTicketNumber('A', 1), 'A-001');
  assert.equal(formatTicketNumber('B', 42), 'B-042');
  assert.equal(formatTicketNumber('C', 1000), 'C-1000');
  assert.ok(TICKET_NUMBER_PATTERN.test('A-001'));
  assert.ok(TICKET_NUMBER_PATTERN.test('ABC-1000'));
  assert.ok(!TICKET_NUMBER_PATTERN.test('A-1'));
  assert.ok(!TICKET_NUMBER_PATTERN.test('a-001'));
  assert.ok(!TICKET_NUMBER_PATTERN.test('A-001; DROP TABLE'));
});

test('nextFreeCode returns the first unused letter, or null when A-Z are all taken', () => {
  assert.equal(nextFreeCode([]), 'A');
  assert.equal(nextFreeCode(['A', 'B', 'D']), 'C');
  const all = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  assert.equal(nextFreeCode(all), null);
});

test('averageConsultMinutes averages usable rows and falls back otherwise', () => {
  const t = (iso) => new Date(iso);
  const rows = [
    { calledAt: t('2026-11-08T09:00:00Z'), completedAt: t('2026-11-08T09:10:00Z') }, // 10
    { calledAt: t('2026-11-08T09:10:00Z'), completedAt: t('2026-11-08T09:30:00Z') }, // 20
    { calledAt: null, completedAt: t('2026-11-08T09:40:00Z') }, // ignored
  ];
  assert.equal(averageConsultMinutes(rows, 7), 15);
  assert.equal(averageConsultMinutes([], 7), 7);
  assert.equal(averageConsultMinutes([{ calledAt: t('2026-11-08T09:00:00Z'), completedAt: t('2026-11-08T09:00:10Z') }], 7), 1);
});

test('database target is described without ever exposing credentials', () => {
  assert.equal(describeDatabaseTarget('mongodb://127.0.0.1:27017/hospital_queue'), '127.0.0.1:27017/hospital_queue');
  assert.equal(
    describeDatabaseTarget('mongodb+srv://bob:S3cret%40pw@cluster0.ab1cd.mongodb.net/queue?retryWrites=true&w=majority'),
    'cluster0.ab1cd.mongodb.net/queue',
  );
  assert.equal(
    describeDatabaseTarget('mongodb://u:p@h1.example.com:27017,h2.example.com:27018/queue?replicaSet=rs0'),
    'h1.example.com:27017,h2.example.com:27018/queue',
  );
  // No database name in the string: the app falls back to "hospital_queue", not MongoDB's "test".
  assert.equal(describeDatabaseTarget('mongodb://localhost:27017'), 'localhost:27017/hospital_queue');
  assert.equal(describeDatabaseTarget('mongodb+srv://bob:pw@cluster0.mongodb.net/?retryWrites=true'), 'cluster0.mongodb.net/hospital_queue');
  assert.equal(describeDatabaseTarget(undefined), 'the address in MONGODB_URI');
  assert.equal(describeDatabaseTarget('not a url'), 'the address in MONGODB_URI');

  // Badly formed strings (password containing "/" or "@" that was not URL-encoded) must not leak any part of it.
  for (const evil of ['mongodb://bob:pa/ss@host.example.com/db', 'mongodb://bob:p@ss@host.example.com/db', 'mongodb://bob/Sup3rS3cret@host/db']) {
    const out = describeDatabaseTarget(evil);
    assert.ok(!/pa\/ss|p@ss|ss@host|Sup3rS3cret|bob:/.test(out), `leaked from ${evil}: ${out}`);
  }
});

test('connection failure message is readable and never prints the password', () => {
  const uri = 'mongodb+srv://bob:S3cret%40pw@cluster0.ab1cd.mongodb.net/queue?retryWrites=true';
  const msg = connectionFailureMessage(new Error('connect ECONNREFUSED 127.0.0.1:27017\n    at stack line'), uri);
  assert.ok(msg.includes('Cannot connect to MongoDB (cluster0.ab1cd.mongodb.net/queue)'));
  assert.ok(msg.includes('connect ECONNREFUSED 127.0.0.1:27017'));
  assert.ok(!msg.includes('at stack line'), 'only the first line of the driver message is shown');
  assert.ok(msg.includes('Database setup') && msg.includes('Atlas') && msg.includes('Services app'));
  assert.ok(!msg.includes('S3cret') && !msg.includes('bob'), 'credentials must not be printed');

  // Even if a driver error quotes the connection string, the credentials are masked.
  const leaky = connectionFailureMessage(new Error(`bad uri ${uri} rejected`), uri);
  assert.ok(!leaky.includes('S3cret') && !leaky.includes('bob:'));
  assert.ok(leaky.includes('mongodb+srv://***@'));
});

test('Mongo error helpers recognise duplicate keys and connection failures', () => {
  assert.equal(isDuplicateKey({ code: 11000 }), true);
  assert.equal(isDuplicateKey({ code: 11001 }), false);
  assert.equal(isDuplicateKey(null), false);
  assert.equal(isConnectionError({ name: 'MongooseServerSelectionError' }), true);
  assert.equal(isConnectionError({ name: 'MongoNetworkError' }), true);
  assert.equal(isConnectionError({ name: 'ValidationError' }), false);
});

test('validators accept good input and normalise it', () => {
  assert.equal(v.str('  John   Doe ', 'name'), 'John Doe');
  assert.equal(v.optionalPhone('0801-234 5678'), '08012345678');
  assert.equal(v.optionalPhone('+234 801 234 5678'), '+2348012345678');
  assert.equal(v.optionalPhone(''), null);
  assert.equal(v.optionalPhone(undefined), null);
  assert.equal(v.email('  Dr.Smith@Hospital.COM '), 'dr.smith@hospital.com');
  assert.equal(v.enumValue('free', 'status', ['FREE', 'OCCUPIED']), 'FREE');
  assert.equal(v.code(' ab '), 'AB');
  assert.equal(v.dateString('2026-02-28', 'date'), '2026-02-28');
  assert.equal(v.id('64b7f0c2a1d3e4f5a6b7c8d9', 'id'), '64b7f0c2a1d3e4f5a6b7c8d9');
});

test('validators reject bad input with a 400 HttpError', () => {
  const rejects = (fn) =>
    assert.throws(fn, (err) => err instanceof HttpError && err.status === 400);

  rejects(() => v.str(undefined, 'name'));
  rejects(() => v.str('   ', 'name'));
  rejects(() => v.str('x'.repeat(101), 'name'));
  rejects(() => v.optionalPhone('12'));
  rejects(() => v.optionalPhone('abc12345678'));
  rejects(() => v.email('not-an-email'));
  rejects(() => v.password('short'));
  rejects(() => v.enumValue('BUSY', 'status', ['FREE', 'OCCUPIED']));
  rejects(() => v.code('A1'));
  rejects(() => v.dateString('2026-02-30', 'date'));
  rejects(() => v.dateString('08/11/2026', 'date'));
  rejects(() => v.id("x'; DROP TABLE", 'id'));
  rejects(() => v.id('123', 'id')); // not 24 characters
  rejects(() => v.id('zzzzzzzzzzzzzzzzzzzzzzzz', 'id')); // 24 characters but not hex
  rejects(() => v.id({ $ne: null }, 'id')); // operator injection attempt
  rejects(() => v.id(undefined, 'id'));
  rejects(() => v.boolean('true', 'active'));
});
