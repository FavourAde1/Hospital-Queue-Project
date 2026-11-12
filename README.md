# Hospital Queue System

An automatic queueing API for hospitals. A patient takes a ticket for a physician and gets a queue number
(`A-001`) with the date and time. Physicians call patients, finish them, and show a **FREE / OCCUPIED**
indicator. Everything updates live over Socket.io.

Stack: Node.js (20+), Express 4, **MongoDB** (Mongoose 8), Socket.io, JWT.

## Quick start

You need a MongoDB database. If MongoDB is already running on your PC, the default settings work as they are.
Otherwise pick an option under **Database setup** below.

```bash
npm install
# Create a local .env file and set JWT_SECRET (see Configuration below).
npm run db:seed              # creates 3 demo physicians (collections and indexes are created automatically)
npm run dev                  # http://localhost:4000
```

Open <http://localhost:4000/board> for the live public board.

There is no migration or "db push" step: MongoDB creates the database, collections and indexes the first time the app runs.
If MongoDB cannot be reached, `npm run dev` and `npm run db:seed` stop and tell you so
(`Cannot connect to MongoDB (127.0.0.1:27017/hospital_queue)`). `npm run dev` does not watch `.env`,
so after editing `.env` stop it with Ctrl+C and start it again.

Demo physicians (password `doctor123`, change it before real use):

| Code | Physician | Email |
|------|-----------|-------|
| A | Dr. Sarah Smith | dr.smith@hospital.com |
| B | Dr. Michael Jones | dr.jones@hospital.com |
| C | Dr. Emily Lee | dr.lee@hospital.com |

## Database setup

Choose one. The app reads the address from `MONGODB_URI` in `.env`.

**A. MongoDB on your own PC (fastest if you already have it)**

Install MongoDB Community Server from <https://www.mongodb.com/try/download/community>. On Windows keep
"Install MongoDB as a Service" ticked, so it starts by itself. Check the Services app: "MongoDB Server" should say Running.
The default `MONGODB_URI="mongodb://127.0.0.1:27017/hospital_queue"` then works with no edits.
Use `127.0.0.1` rather than `localhost`: on some systems Node tries `localhost` as IPv6 first, which MongoDB does not listen on by default, and the connection then fails.

**B. MongoDB Atlas (free hosted, nothing to install)**

1. Create a free cluster at <https://www.mongodb.com/cloud/atlas> and a database user (user name + password).
2. Under *Network Access*, allow your IP address (for quick testing "Allow access from anywhere" works, but do not leave that on for real use).
3. Click *Connect → Drivers* and copy the connection string into `.env`, adding the database name before the `?`:
   ```
   MONGODB_URI="mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/hospital_queue?retryWrites=true&w=majority"
   ```
   Special characters in the password must be URL-encoded (`@` becomes `%40`, `#` becomes `%23`).
   Without `/hospital_queue` your data would land in a database called `test`; the app guards against that, but it is better to be explicit.

**C. Docker**

```bash
docker compose up -d
```

The default `MONGODB_URI` already points at it.

## How it works

```
Patient  GET  /patients/physicians      -> sees who is FREE / OCCUPIED and how many are waiting
Patient  POST /patients/tickets         -> gets A-001, date/time, position, estimated wait
Doctor   POST /physicians/login         -> token
Doctor   POST /physicians/me/call-next  -> ticket CALLED, doctor OCCUPIED
Doctor   POST /physicians/me/complete   -> ticket COMPLETED, doctor FREE
         (or /me/skip when the patient does not show up -> ticket SKIPPED, doctor FREE)
```

- Each physician has a 1-3 letter **code**; tickets are `<code>-<number>`, numbered from 001 each day.
- "Day" follows `HOSPITAL_TIMEZONE`, not the server clock.
- Queue order: URGENT tickets first, then first come first served.
- Leftover tickets from earlier days are marked `EXPIRED` automatically (at startup and every 10 minutes).

Ticket statuses: `WAITING -> CALLED -> COMPLETED | SKIPPED`, or `EXPIRED`.

### Data (MongoDB collections)

| Collection | Holds |
|------------|-------|
| `physicians` | name, email, password hash, specialty, department, `code`, `status` (FREE/OCCUPIED), `active` |
| `patients` | name, phone |
| `tickets` | `ticketNumber`, `sequence`, `queueDate`, `status`, `priority`, `patientId`, `physicianId`, `createdAt`, `calledAt`, `completedAt` |
| `counters` | one document per physician per day, used to hand out the next number |

Ids in API responses are MongoDB ObjectIds written as 24-character hex strings.

### Why two requests at the same moment cannot break the queue

MongoDB on a plain local install has no transactions, so the rules are enforced by the database itself:

- Ticket numbers come from an atomic counter (`$inc`), so two patients can never receive the same number.
- A **unique index** allows at most one `CALLED` ticket per physician. If a doctor double-clicks "call next", the second request is rejected (409).
- "Call next", "complete" and "skip" claim the ticket with a conditional update ("only if it is still WAITING / CALLED"), so a ticket is never handled twice.
- If a ticket is created and the process then dies before the daily counter is used again, a number may be skipped (for example A-004 never appears). Numbers are never duplicated.

## Staff dashboard and demo login

Open **http://localhost:4000/dashboard** after starting the server. The dashboard has separate administrator/reception and physician workspaces. The public display remains at **http://localhost:4000/board**.

For a fresh local setup:

1. Create a local `.env` file and set `JWT_SECRET` (see Configuration below). The default MongoDB address is `mongodb://127.0.0.1:27017/hospital_queue`.
2. Run `npm install`, then `npm run db:seed`, then `npm run dev`.
3. Administrator dashboard: username `admin`; access key `dev-admin-key-change-me` (the value of `ADMIN_API_KEY` in `.env`).
4. Demo physicians (after `npm run db:seed`): `dr.smith@hospital.com`, `dr.jones@hospital.com`, or `dr.lee@hospital.com`; password `doctor123` (unless `SEED_PASSWORD` is set).

**Security:** These are development-only credentials. Change `ADMIN_API_KEY`, `JWT_SECRET`, and all demo physician passwords before any real deployment. The admin dashboard authenticates using the configured admin API key; it is not a separate admin user database. Do not expose the development key to the public internet.

### Dashboard improvements

- Responsive, color-coded hospital operations dashboard for reception/admin and physicians.
- Live queue refresh through Socket.IO, plus ticket search and daily CSV export for reception.
- MongoDB IPv4 connection configuration, explicit ping verification, and connection lifecycle logging for clearer local setup diagnostics.

## API

Errors are JSON: `{ "error": "message" }` with a suitable status code (400, 401, 404, 409, 429, 503).

### Patients (public)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/patients/physicians` | Physicians with `status` (FREE/OCCUPIED), `nowServing`, `waitingCount`, `nextUp` |
| POST | `/patients/tickets` | Take a ticket |
| GET | `/patients/tickets/:ticketNumber` | Status and position of **today's** ticket, e.g. `A-007` |
| GET | `/queue/status` | Data for the public board |

```bash
curl http://localhost:4000/patients/physicians

curl -X POST http://localhost:4000/patients/tickets \
  -H "Content-Type: application/json" \
  -d '{"patientName":"John Doe","phone":"08012345678","physicianId":"<id from the list>"}'
```

`phone` is optional. If the same name + phone already has an active ticket with that physician, the request gets `409`
with the existing `ticketNumber`. This check needs a phone number: without one, the system cannot tell two patients
with the same name apart, so each request gets its own ticket.

Ticket response:

```json
{
  "ticket": {
    "id": "6710c3f2a9d1e4b7c8a05f12",
    "ticketNumber": "A-001",
    "status": "WAITING",
    "priority": "NORMAL",
    "queueDate": "2026-11-08",
    "createdAt": "2026-11-08T07:53:12.000Z",
    "position": 1,
    "estimatedWaitMinutes": 5,
    "physician": { "id": "...", "code": "A", "name": "Dr. Sarah Smith", "specialty": "General Medicine", "status": "OCCUPIED" }
  }
}
```

Patient-facing responses never include patient names or phone numbers, because ticket numbers are short and guessable.
`estimatedWaitMinutes` is a rough guess from the patients ahead and the average consultation length so far today.

### Physicians (Bearer token)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/physicians/login` | `{ "email", "password" }` -> `{ token, physician }` |
| GET | `/physicians/me` | My profile and current status |
| GET | `/physicians/me/queue` | Current patient + waiting list (with patient names) |
| POST | `/physicians/me/call-next` | Call next patient -> OCCUPIED |
| POST | `/physicians/me/complete` | Finish current patient -> FREE |
| POST | `/physicians/me/skip` | Called patient did not show -> SKIPPED, FREE |
| PATCH | `/physicians/me/status` | `{ "status": "FREE" \| "OCCUPIED" }` (e.g. break or emergency) |

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/physicians/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dr.smith@hospital.com","password":"doctor123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/physicians/me/queue
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:4000/physicians/me/call-next
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:4000/physicians/me/complete
```

(On Windows PowerShell, Postman or Thunder Client is easier than curl for these.)

You cannot call the next patient while one is still called (`409`), and you cannot set yourself FREE while a
called patient is unresolved.

### Admin / reception (`x-admin-key` header = `ADMIN_API_KEY`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/physicians` | All physicians, including inactive |
| POST | `/admin/physicians` | `{ name, email, password, specialty, department?, code? }` |
| PATCH | `/admin/physicians/:id` | `{ "active": false }` disables a physician |
| POST | `/admin/tickets` | Reception ticket; same body as patients plus `"priority": "URGENT"` |
| GET | `/admin/tickets?date=YYYY-MM-DD` | Every ticket for a day (default today), with patient details |

If `ADMIN_API_KEY` is empty the admin API returns `503`.

## Real-time (Socket.io)

```js
// Public screens and patients: no token needed.
const socket = io('http://localhost:4000');

// Physicians: connect with the login token to also receive private events.
const doctorSocket = io('http://localhost:4000', { auth: { token } });
```

| Event | Room | Payload |
|-------|------|---------|
| `queue:updated` | public | `{ physicianId, reason, at }` |
| `ticket:called` | public | `{ ticketNumber, physicianId, physicianName, calledAt }` |
| `physician:status` | public | `{ physicianId, status }` |
| `ticket:created` | that physician only | `{ ticketNumber, patientName, priority, createdAt }` |

Public events carry no patient information. Patient names only go to the physician's private room, which
requires a valid token.

## Configuration

Create a local `.env` file for configuration; `.env` and `.env.example` are intentionally excluded from Git. `JWT_SECRET` is required. For local development, you can generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set the generated value as `JWT_SECRET` in `.env`. The important configuration variables are:

| Variable | Meaning |
|----------|---------|
| `MONGODB_URI` | MongoDB connection string, with the database name in it. Default `mongodb://127.0.0.1:27017/hospital_queue` |
| `JWT_SECRET` | Signs physician tokens. In production it must be random and 32+ characters |
| `ADMIN_API_KEY` | Enables `/admin/*` |
| `HOSPITAL_TIMEZONE` | IANA zone that decides when a new day (and ticket numbering) starts. Default `Africa/Lagos` |
| `CORS_ORIGIN` | `*` for development; list your real front-end origins in production |
| `TRUST_PROXY` | Number of reverse proxies in front of the app, so rate limits see client IPs |

## Project layout

```
scripts/seed.js             demo physicians
src/server.js               HTTP + Socket.io + stale-ticket sweep
src/app.js                  Express setup
src/models/index.js         Mongoose schemas and indexes (Physician, Patient, Ticket, Counter)
src/lib/db.js               MongoDB connection
src/routes/                 patients, physicians, queue, admin
src/services/               queueService (call/complete/skip/status), ticketService (create/lookup), realtime
src/middleware/             auth, rate limits, error handling
src/utils/                  pure helpers (covered by tests)
public/board.html, board.js live public display board
test/utils.test.js          unit tests for the helpers
```

## Tests

```bash
npm test
```

These cover the pure helpers (time zone dates, ticket numbers, validation, connection-string handling, averages).
The database-backed flows are not automated in this project; try them with the requests above.

## Moving from the earlier PostgreSQL version

Unzip this version into a fresh folder, run `npm install`, copy your old `.env` over and add the `MONGODB_URI` line
(the old `DATABASE_URL` line is ignored). There is nothing to migrate if you only used the demo data. The `prisma` folder and Docker's
PostgreSQL are no longer used.

## Database connection troubleshooting (Windows)

The default local URI is `mongodb://127.0.0.1:27017/hospital_queue`. The application explicitly uses IPv4 to avoid `localhost` resolving to `::1` while the MongoDB Windows service listens on `127.0.0.1`. Confirm the service is running with `Get-Service MongoDB` and port connectivity with `Test-NetConnection 127.0.0.1 -Port 27017`. The server performs a MongoDB ping before listening on port 4000 and prints connection/disconnection events.

Queue transition serialization is in-process and is intended for the basic single-server deployment. If you run multiple Node.js instances behind a load balancer, introduce a distributed lock or move queue transitions to a MongoDB replica-set transaction before scaling horizontally.

## Before going live

- Replace the demo password and set strong `JWT_SECRET` and `ADMIN_API_KEY` (the app refuses weak ones when `NODE_ENV=production`).
- Set `MONGODB_URI` explicitly (production refuses to start with the local default), use a database user with only the access it needs,
  restrict Atlas Network Access to your server's IP, and turn on backups.
- Serve over HTTPS and set `CORS_ORIGIN` and `TRUST_PROXY`.
- Patient data (names, phone numbers) is personal health-related information. Check what your local data-protection rules require
  (for example NDPA in Nigeria) before storing it, and decide how long tickets are kept.

## Ideas for next steps

SMS when a ticket is called, a kiosk page for patients, patient-side ticket cancellation, department-based assignment,
a Postman collection.
