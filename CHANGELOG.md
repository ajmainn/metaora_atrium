# Atrium Change Log

Short tracking notes for implementation work and why each change was made.

## Database and Migrations

- Updated `scripts/migrate.mjs`
  - Fixed fresh database setup so `001_init.sql` runs on a clean database.
  - Kept migration tracking safe for databases where `001_init.sql` had already been applied before tracking existed.

- Added `migrations/003_data_integrity_hardening.sql`
  - Repaired remaining confirmed starter-data defects without changing `001_init.sql`.
  - Rounded fractional enrolment credits.
  - Cancelled/refunded invalid active enrolments on cancelled sessions.
  - Removed check-ins tied to cancelled sessions.
  - Fixed session 83 over-capacity state.
  - Cancelled/refunded coach self-enrolment and person 28 overlap.
  - Added basic non-null and validity constraints for core domain fields.

- Added `migrations/004_data_integrity_followup.sql`
  - Idempotent follow-up for local databases that had already applied an early version of `003`.
  - Ensures current and fresh databases end in the same clean state.

## Public Session Catalogue

- Updated `api/src/routes/sessions.ts`
  - Public session list now returns only catalogue-safe fields.
  - Removed private user/attendee data from the anonymous list response.
  - Replaced per-session lookup queries with one joined aggregate query.

- Updated `web/app/page.tsx`
  - Added public catalogue fields: discipline, date/time, session type, participant fee, and places remaining.
  - Displays times in `America/New_York`.
  - Added fee schedule, coach booking deadline, refund policies, coach-cancellation refund rule, and essential booking/opening rules.
  - Added empty and error states.

- Added `web/app/loading.tsx`
  - Provides a simple loading state for the public catalogue route.

- Updated `web/app/globals.css`
  - Added minimal responsive styling for the public catalogue.
  - Improved table behavior on small screens.

## Unified Login and Role Access

- Updated `api/src/auth.ts`
  - Kept the existing signed-cookie session flow.
  - Added active-user checks and role-aware current-user loading.
  - Replaced new password hashes with scrypt while preserving seed SHA-256 login compatibility.

- Updated protected API routes
  - Made `/api/people` admin-only.
  - Limited `/api/rooms` to admins and coaches.
  - Filtered session detail responses by authenticated role.
  - Restricted session write/cancel paths to admins and owning coaches.

- Updated login and dashboard pages
  - Login now redirects by authenticated role.
  - Added minimal participant and coach dashboards.
  - Added basic admin-page guards.

## Coach Session Cancellation Refunds

- Added `api/src/sessionCancellation.ts`
  - Centralized coach cancellation refund updates.
  - Keeps coach room-fee refunds on the existing tiered notice policy: 100%, 50%, 25%, or 0%.
  - Refunds every active participant enrolment at 100% of `credits_charged` when the coach cancels.
  - Updates enrolment status, refund fields, participant balances, coach balance, and session status transactionally.

- Updated `api/src/routes/sessions.ts`
  - Replaced inline cancellation refund logic with the shared cancellation helper.
  - Preserved the existing authenticated coach/admin cancellation route behavior.

- Added `api/test/sessionCancellation.test.ts`
  - Covers all coach cancellation refund tiers.
  - Confirms participants always receive full enrolment refunds.

Why:
- Participants must be made whole when the coach cancels because the participant did nothing wrong.
- The previous flow incorrectly applied the coach's notice-based refund percentage to participant enrolments.
- The helper keeps the behavior small, testable, and inside the existing transaction boundary.

## Coach/Admin Session Creation Validations

- Added `api/src/sessionCreation.ts`
  - Centralized session booking-domain validation and atomic creation.
  - Enforces the 48-hour coach booking notice rule.
  - Allows sessions only Monday-Saturday.
  - Enforces centre hours of 07:00-21:00 in `America/New_York`.
  - Validates exact durations for `short`, `standard`, and `intensive` sessions.
  - Uses half-open overlap logic: `existing.start < new.end AND existing.end > new.start`.
  - Rejects scheduled room conflicts.
  - Rejects coach commitment conflicts from teaching or active participant enrolments.
  - Ignores cancelled sessions and cancelled enrolments for conflict checks.
  - Reuses the existing fee helpers for room and seat fees.
  - Locks the coach row, validates credits, and uses guarded deduction to prevent negative balances.

- Updated `api/src/routes/sessions.ts`
  - Runs session creation through the new helper.
  - Keeps admin-selected coach behavior and coach self-booking behavior.
  - Maps booking-domain errors to client-facing HTTP responses.

- Updated `api/src/db.ts`
  - Added optional transaction isolation support.
  - Session creation now runs at PostgreSQL `serializable` isolation for concurrency safety.

- Added `api/test/sessionCreation.test.ts`
  - Covers valid booking, 48-hour rejection, Sunday rejection, centre-hours rejection, half-open adjacency, room overlap, coach teaching overlap, coach enrolment overlap, insufficient credits, and all required session durations.

Why:
- The assignment booking rules must be enforced by the API, not only by UI behavior or database constraints.
- The previous flow checked only basic room/coach existence and used closed overlap bounds.
- Credit deduction must be part of the same concurrency-safe transaction as validation and session insertion.

## Verification

- Existing tests pass with `npm.cmd test`.
- Full build passes with `npm.cmd run build`.
- Migration verification passed on current database and a temporary fresh database.
