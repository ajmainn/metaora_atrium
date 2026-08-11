# Atrium

Atrium is a full-stack booking system for a coaching centre with twelve rooms in
`America/New_York`. Coaches book rooms to run sessions, participants book seats,
coaches can also attend other coaches' sessions, credits move on booking and
cancellation, and each role sees only the data it is allowed to see.

## Implemented Features

- Public session catalogue with fees, availability, booking by email, and policy information.
- Unified login for administrator, coach, and participant accounts.
- Role dashboards for participant bookings, coach teaching/attending/busy periods, and administrator scheduling.
- Session creation, rescheduling, booking, cancellation, refunds, and credit accounting.
- Coach attendance in another coach's session, while self-enrolment is rejected.
- Calendar views for every role, with coach busy periods filtered as required.
- Check-in/attendance workflow for owning coaches and administrators.
- Event email notifications and scheduled daily emails through SMTP/Mailpit.
- Role-aware AI assistant with anonymous, participant, coach, and administrator behavior.
- Responsive, styled Next.js UI with loading, empty, and error states.

## Tech Stack

| Area | Choice |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL with raw `pg` queries |
| Email | Nodemailer SMTP, configured for Mailpit in development |
| Scheduler | `node-cron`, scheduled in `America/New_York` |
| Assistant | Deterministic stub for tests/dev; Ollama-compatible provider for real mode |
| Tests | Node built-in test runner |

## Prerequisites

- Node.js 20 or newer, with npm.
- PostgreSQL.
- Mailpit for local email capture.
- Optional: an Ollama-compatible provider if running the assistant in real model mode.

## Clean Clone Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create an empty PostgreSQL database, for example:

   ```powershell
   createdb atrium
   ```

   If your PostgreSQL setup does not provide `createdb`, create a database named
   `atrium` with your usual PostgreSQL tool.

3. Copy the environment template and edit local values:

   ```powershell
   Copy-Item env.example .env
   ```

   Set `DATABASE_URL` for your local database and replace `SESSION_SECRET`.
   Real secrets belong only in `.env`; do not commit them.

4. Run migrations and seed data:

   ```powershell
   npm run migrate
   ```

5. Start Mailpit in a separate terminal:

   ```powershell
   mailpit --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025
   ```

6. Start the API and web app in separate terminals:

   ```powershell
   npm run dev:api
   npm run dev:web
   ```

7. Open:

   - Web app: `http://localhost:3000`
   - API base: `http://localhost:4000`
   - Mailpit inbox: `http://localhost:8025`

On Windows PowerShell, if script execution blocks `npm`, use `npm.cmd` instead
of `npm`, for example `npm.cmd test`.

## Environment Variables

The repository uses `env.example` as the template. Copy it to `.env`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by migrations and the API. |
| `NODE_ENV` | Runtime mode; production enables secure cookies. |
| `API_PORT` | Express API port, default `4000`. |
| `WEB_PORT` | Documented web port; Next dev script currently binds `3000`. |
| `API_BASE_URL` | URL the web app uses to call the API. |
| `WEB_BASE_URL` | URL used for CORS and password setup links. |
| `CENTRE_TIMEZONE` | Centre timezone for hours, calendars, and scheduled jobs. |
| `SESSION_SECRET` | HMAC secret for signed session cookies; replace locally. |
| `SEED_ADMIN_EMAIL` | Fallback administrator email for notifications. |
| `SEED_ADMIN_PASSWORD` | Documented development admin password. |
| `MAIL_TRANSPORT` | Informational; SMTP is implemented. |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server; Mailpit defaults are `localhost:1025`. |
| `SMTP_FROM`, `MAIL_FROM` | Sender address for outgoing mail. |
| `SMTP_USER`, `SMTP_PASSWORD` | Optional SMTP credentials. Leave blank for Mailpit. |
| `SCHEDULER_ENABLED` | Set `false` to disable daily cron jobs. |
| `ASSISTANT_PROVIDER` | `stub` or `ollama`. |
| `ASSISTANT_USE_STUB` | `true` forces deterministic assistant behavior. |
| `ASSISTANT_BASE_URL` | Ollama-compatible base URL, usually `http://localhost:11434`. |
| `ASSISTANT_MODEL` | Model name for real assistant mode. |
| `ASSISTANT_API_KEY` | Optional provider API key; leave blank unless required. |
| `ASSISTANT_TIMEOUT_MS` | Assistant provider timeout. |

## Development Logins

These are seeded development/demo credentials only:

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@atrium.local` | `admin` |
| Coach | `oscar.lindqvist@atrium.local` | `coach123` |
| Participant | `sofia.marino@atrium.local` | `participant123` |

## Testing And Builds

Latest verified status:

- API tests: 137 passing.
- Web tests: 4 passing.
- API TypeScript production build: passed.
- Next.js production build: passed.

Commands:

```powershell
npm.cmd test
npm.cmd --workspace api run test
npm.cmd --workspace web run test
npm.cmd run build
```

## Booking Rules

- The centre is open Monday to Saturday, 07:00 to 21:00 New York time, and closed Sundays.
- Coaches must create sessions at least 48 hours before the start time.
- Session intervals are half-open: ending at 10:00 and starting at 10:00 do not overlap.
- A room can hold only one scheduled session at a time.
- A person cannot have overlapping commitments, whether teaching or attending.
- `SHORT` sessions last 45 minutes.
- `STANDARD` sessions last 60 minutes.
- `INTENSIVE` sessions teach for 180 minutes and hold the room for 210 minutes; the full 210-minute interval blocks all coach and participant conflicts, including the lunch interval.
- Room capacity counts participants only and excludes the coach.
- A coach cannot enrol in their own session.
- Cancelled sessions and cancelled enrolments do not consume room, capacity, or person availability.

## Credits And Fees

Credits are always whole integers. New participant accounts receive 4000 credits;
new coach accounts receive 2000 credits.

| Session type | Room fee paid by coach | Seat fee paid by attendee |
|---|---:|---:|
| Short | 30 credits | 15 credits |
| Standard | 40 credits | 20 credits |
| Intensive | 120 credits | 60 credits |

Fractional refunds are rounded down so the system never refunds more than the
calculated proportional amount.

## Cancellation And Refunds

Coach room-fee refund tiers:

| Notice before start | Refund |
|---|---:|
| 96 hours or more | 100% |
| 48 up to 96 hours | 50% |
| 24 up to 48 hours | 25% |
| Under 24 hours | 0% |

When a coach or administrator cancels a session, active participant/attendee seat
fees are refunded in full because the attendee did nothing wrong.

Participant cancellation tiers:

| Notice before start | Refund |
|---|---:|
| 48 hours or more | 100% |
| 24 up to 48 hours | 50% |
| 12 up to 24 hours | 25% |
| Under 12 hours | 0% |

This shape rewards early cancellation while limiting the centre's loss when a
seat is unlikely to be rebooked at short notice. Cancellation after a session has
started receives no refund.

## Roles And Visibility

- Anonymous visitors see the public catalogue: scheduled sessions, cost, capacity, and places remaining.
- Participants see their own bookings, booking history, and credit balance.
- Coaches see their own sessions with attendee details, their own attendee bookings, and other coaches' booked slots only as busy periods.
- Administrators see rooms, people, sessions, attendees, credits, and attendance.

Role and person identity are derived from the signed server session. The frontend
does not provide trusted role/person identifiers.

## Email Notifications

Event-driven email paths:

- Coach or administrator cancels a session: administrators and affected attendees are notified.
- A participant or coach books a coach's session: that session's coach is notified.
- A participant/attendee cancels their booking: that session's coach is notified.
- A coach creates a room booking: administrators are notified.
- A coach cancels a room/session: administrators are notified.
- Rescheduling notifies administrators, relevant coach recipients, and active affected attendees.

Scheduled jobs run at `00:00` in `America/New_York`:

- Coaches with teaching or attending commitments for that local day receive a daily summary.
- Coaches with no commitments receive no email.
- Administrators receive a daily digest of bookings and attendance counts.

Mailpit receives development email through SMTP on `localhost:1025`; view messages
at `http://localhost:8025`.

## AI Assistant

The shared assistant UI is at `/assistant` and calls `POST /api/assistant`.

Supported contexts:

- Anonymous: public catalogue questions and email-only session booking with password setup.
- Participant: search, book, cancel own booking, list own bookings, report own balance.
- Coach: own past/upcoming sessions, attendee/cancellation/check-in detail for own sessions, repeated attendees, cancel/reschedule own sessions.
- Administrator: full session and people visibility plus management actions.

The server resolves the caller from the signed session cookie, builds
permission-filtered data, and exposes only role-allowed tools. The model is never
given data outside the caller's authorized context.

Tests and local development default to deterministic stub mode:

```env
ASSISTANT_PROVIDER=stub
ASSISTANT_USE_STUB=true
```

To use a real Ollama-compatible provider, set:

```env
ASSISTANT_PROVIDER=ollama
ASSISTANT_USE_STUB=false
ASSISTANT_BASE_URL=http://localhost:11434
ASSISTANT_MODEL=llama3.2:3b
ASSISTANT_API_KEY=
```

Set `ASSISTANT_API_KEY` only if your provider requires one, and keep it only in
local `.env`.

## Database Design And Integrity

The base migration carries the starter schema and seed data. Follow-up migrations
repair seed defects and add validation.

PostgreSQL enforces:

- Valid person roles, session statuses, enrolment statuses, and session types.
- Session duration by type.
- Positive room capacity.
- Whole, nonnegative credits and fees.
- Refunds within charged amounts.
- Case-insensitive unique email addresses.
- One active enrolment per person/session.
- One active non-voided check-in per enrolment.
- Valid void metadata for historical check-ins.

Application/domain code enforces rules that span rows or depend on the acting
user: opening hours, 48-hour coach booking notice, room conflicts, coach and
participant overlap checks, capacity, self-enrolment, ownership, authorization,
credit debits/refunds, reschedule fee deltas, and attendance permissions.

The split is deliberate: simple row-level invariants live in PostgreSQL, while
multi-row scheduling, credit, and authorization decisions run in application
transactions with locks and guarded updates.

## Database Defects Found And Fixed

| Issue found | Root cause | Fix |
|---|---|---|
| Existing base schema was not always marked migrated | Starter data could already exist without `schema_migrations` state | Migration script detects existing base tables and records `001_init.sql`. |
| Fractional person/session/enrolment credit values | Seed data used decimal credit values despite integer-credit rule | Rounded existing values and added integer checks. |
| Fees inconsistent with session type | Seeded rows did not always match the chosen fee schedule | Rewrote fees by session type and added fee integer checks. |
| Incorrect intensive durations | Some intensive rows did not occupy 210 minutes | Corrected rows and added duration constraint. |
| Duplicate check-ins | Seed data included duplicate attendance for one enrolment | Preserved history with voided duplicate handling and unique active check-in index. |
| Room and coach overlaps | Seed sessions violated scheduling rules | Cancelled conflicting seeded sessions. |
| Active enrolments/check-ins on cancelled sessions | Cancelled sessions still had active attendee records | Cancelled/refunded invalid enrolments and ignored/voided invalid attendance. |
| Over-capacity session | More active enrolments than room capacity | Cancelled/refunded excess seeded enrolments. |
| Coach self-enrolment | A coach appeared as an attendee in their own session | Cancelled/refunded invalid enrolment. |
| Participant overlap | One attendee held overlapping commitments | Cancelled/refunded the invalid commitment. |
| Historical check-in deletion risk | Earlier cleanup removed check-in rows | Restored deleted seed check-ins as voided audit records. |
| Anonymous booking needed secure password setup | Visitors can book before having an account password | Added single-use hashed password setup tokens. |

No performance-only index optimization was added, and there is no valid before/after
`EXPLAIN (ANALYZE, BUFFERS)` evidence to report.

## Transactions And Isolation

These write paths use serializable transactions:

| Path | Notes |
|---|---|
| Session creation | Locks coach row, checks room/person conflicts, inserts session, debits room fee. |
| Session rescheduling | Locks session, coach, and active enrolments; rechecks conflicts/capacity; applies fee deltas. |
| Signed-in booking | Locks session/person state; checks capacity, duplicate, self-enrolment, overlaps, and credits. |
| Anonymous booking | Finds or creates participant, books through normal booking logic, creates setup token if needed. |
| Participant cancellation | Locks enrolment/person, applies refund tier, updates balance. |
| Coach/admin session cancellation | Locks session and active enrolments, refunds coach room fee by policy and attendees in full. |
| Attendance/check-in write | Locks session/enrolment and active check-in row, inserts or voids active attendance. |
| Password setup | Locks token/person state, stores scrypt password, marks token used. |

Serializable isolation prevents committed serialization anomalies, but it can
still abort under contention; callers receive a retryable conflict response
rather than an automatic retry. The code also relies on row locks, guarded balance
updates, and PostgreSQL uniqueness constraints for correctness.

## Assumptions And Interpretations

- Times shown to users, opening hours, calendar grouping, and scheduled emails are interpreted in `America/New_York`. If the centre timezone changes, scheduling and display helpers must change together.
- Participant "change booking" is implemented as cancel-and-rebook because the brief explicitly requires participant search, book, cancel, own bookings, and balance, but does not require a separate move-enrolment workflow. If a separate atomic move is expected, it should reuse the same cancellation, booking, capacity, overlap, credit, and email rules.
- Cancelled sessions and cancelled enrolments do not consume capacity or availability.
- Participant capacity excludes the coach.
- Half-open intervals allow back-to-back commitments at the exact boundary.

## Known Limitations

No mandatory assignment gap is knowingly left open. Operational limitations:

- Real assistant mode depends on a configured Ollama-compatible provider being reachable.
- Serialization failures are returned as conflicts for the caller to retry; the HTTP layer does not retry automatically.
- Mailpit is a development SMTP target, not a production mail service.

## Demo Flow

Recommended walkthrough:

1. Open `/` and show the public catalogue, fees, availability, and refund policy.
2. Book a public session by email and show the password setup email in Mailpit.
3. Log in as participant, coach, and administrator from the same `/login` form.
4. Show participant bookings/credits, coach teaching/attending/busy periods, and admin session calendar.
5. Create a coach session, book another coach's session as an attendee, cancel or reschedule a session, and show resulting emails in Mailpit.
6. Mark attendance/check-ins from a coach-owned session.
7. Ask the assistant similar questions while anonymous and signed in as different roles to show permission-filtered answers.
