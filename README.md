# Atrium

Atrium is a Node, PostgreSQL, and Next.js booking system. Times shown to users and scheduled jobs use `America/New_York`.

## Setup

1. Install Node 20+ and PostgreSQL.
2. Copy `env.example` to `.env` and set `DATABASE_URL` and `SESSION_SECRET`.
3. Run `npm install`.
4. Run `npm run migrate`.
5. Run `npm run dev:api` and `npm run dev:web` in separate terminals.
6. Open `http://localhost:3000`.

Development logins are `admin@atrium.local` / `admin`, `oscar.lindqvist@atrium.local` / `coach123`, and `sofia.marino@atrium.local` / `participant123`. They are local seed credentials and must not be used in production.

Run `npm test` for API tests and `npm run build` for both production builds.

Visitors can book from the public catalogue with only an email address. If the address is new, Atrium creates one active participant account with the required 4000 starting credits, books the selected session through the normal participant booking transaction, and sends a password setup link to that address. Existing emails reuse the existing account, so no duplicate account or second starting-credit grant is created.

Password setup links use 32 bytes of random token material, expire after 24 hours, and are single-use. Only a SHA-256 token digest is stored in `password_setup_token`; the password itself is saved with the same scrypt hashing used by normal login. `WEB_BASE_URL` controls the link host and the included `.env` already sets it to `http://localhost:3000`.

## Data Review

The supplied `001_init.sql` is unchanged. Later migrations correct individual confirmed defects: fractional credit values, fees inconsistent with session type, two intensive durations, room and coach overlaps, active enrolments on cancelled sessions, an over-capacity session, coach self-enrolment, and one participant overlap.

Earlier cleanup migrations deleted nine seeded check-ins. Migration 007 restores their original IDs, enrolment links, and timestamps. The events are marked void instead of being erased: three belong to over-capacity enrolments, four to cancelled sessions, one to coach self-enrolment, and one is a duplicate check-in. Attendance counts ignore voided events. This preserves the dataset while retaining one valid attendance event per enrolment.

No performance-only index was added, so there is no before/after `EXPLAIN (ANALYZE, BUFFERS)` claim.

## Credits And Refunds

Accounts begin with 4000 participant credits or 2000 coach credits. Fees are: short 30 room / 15 seat credits, standard 40 / 20, and intensive 120 / 60. Credits and refunds are whole integers; fractional refunds round down so a proportional refund never issues more credit than the calculated amount.

Coach room cancellations refund 100% with at least 96 hours' notice, 50% from 48 hours, 25% from 24 hours, and 0% below 24 hours. A coach cancellation refunds active attendees in full. Participant cancellations refund 100% with at least 48 hours' notice, 50% from 24 hours, 25% from 12 hours, and 0% below 12 hours. These tiers reward early notice while limiting losses from places unlikely to be rebooked. Cancellation after a session starts receives no refund.

## Invariants And Transactions

The schema enforces valid roles, statuses, session types and durations; positive room capacity; integer and nonnegative credits; valid refund ranges; case-insensitive unique emails; one active enrolment per person/session; and one non-voided check-in per enrolment. Application transactions enforce room, coach, participant-overlap, capacity, ownership, notice, and balance rules because those checks span multiple rows or depend on the acting user.

Session creation, signed-in booking, anonymous visitor booking, participant cancellation, coach cancellation, and password setup use serializable transactions. Row locks and guarded updates protect balances, capacity, token use, and duplicate-account checks. Serializable isolation prevents committed serialization anomalies, but callers must still retry a transaction rejected with a serialization failure; the current HTTP layer reports such a failure rather than retrying automatically. Login/logout use their existing single-statement/default-isolation paths.

## Assumptions And Unfinished Work

The centre timezone is New York, cancelled sessions and enrolments do not consume capacity, participant capacity excludes the coach, and half-open time ranges permit one commitment to end exactly when another begins. If these assumptions change, conflict and scheduler windows must change with them.

The AI assistant, full rescheduling, and attendance/check-in workflow are unfinished. Rescheduling emails are therefore also unfinished. These were left out to finish and validate the existing booking, cancellation, access, calendar, email, scheduler, and visitor account setup paths first.
