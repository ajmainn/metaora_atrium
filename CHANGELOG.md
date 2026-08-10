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

## Participant Session Booking

- Added `api/src/sessionEnrolment.ts`
  - Centralized participant/coach-as-participant booking logic.
  - Allows participants to book sessions.
  - Allows coaches to attend another coach's session as a participant.
  - Rejects coach self-enrolment.
  - Allows booking only scheduled sessions.
  - Rejects duplicate active enrolments for the same person and session.
  - Enforces participant capacity using active enrolments only; the coach is excluded.
  - Rejects overlapping commitments from teaching or active enrolments using half-open interval logic.
  - Ignores cancelled sessions and cancelled enrolments for conflict checks.
  - Charges the session's existing participant fee, writes integer credit fields, and creates active enrolments with zero refund.
  - Locks the session and person rows, validates credits, and uses guarded deduction to prevent negative balances.

- Updated `api/src/routes/sessions.ts`
  - Added authenticated `POST /api/sessions/:id/book`.
  - Runs the whole enrolment operation in a serializable transaction.
  - Returns only the caller's enrolment record, avoiding other participant data.

- Added `api/test/sessionEnrolment.test.ts`
  - Covers successful participant booking, coach attending another coach's session, self-enrolment rejection, duplicate rejection, capacity rejection, teaching overlap, enrolment overlap, half-open adjacency, insufficient credits, cancelled session rejection, and credit/enrolment fields.

Why:
- Participants and coaches need a transactional way to book seats in scheduled sessions.
- The API must enforce capacity, duplicate, credit, and commitment rules rather than relying on UI behavior.
- Session/person locking plus serializable isolation keeps capacity and balance updates concurrency-safe.

## Participant Booking Cancellation Refunds

- Updated `api/src/sessionEnrolment.ts`
  - Added participant-side enrolment cancellation logic.
  - Added the participant refund tiers from the public page: 100%, 50%, 25%, or 0% based on notice before session start.
  - Reuses `hoursOfNotice` and `refundAmount` so refund timing and integer rounding stay consistent with existing credit helpers.
  - Allows participants and coaches attending as participants to cancel only their own active enrolments.
  - Rejects another person's enrolment, already-cancelled enrolments, and enrolments whose session has already been coach-cancelled.
  - Updates enrolment status, `credits_refunded`, and `cancelled_at` without changing `credits_charged`.
  - Locks the enrolment and person row, then credits the user's balance in the same transaction.

- Updated `api/src/routes/sessions.ts`
  - Added authenticated `POST /api/sessions/:id/enrolments/:enrolmentId/cancel`.
  - Runs participant-side cancellation in a serializable transaction.
  - Returns only the caller's updated enrolment/refund result.

- Added `api/test/sessionEnrolmentCancellation.test.ts`
  - Covers all participant refund tiers, integer rounding, own-cancellation for participants and coaches, ownership rejection, already-cancelled rejection, balance updates, and enrolment field updates.

Why:
- Participants need a safe way to cancel their own paid bookings and receive the public-page refund policy.
- Ownership and status checks must happen at the API so users cannot cancel or inspect another person's enrolment.
- The refund and balance update need to be atomic to avoid partial cancellation states.

## Participant and Coach Dashboards

- Updated `api/src/routes/sessions.ts`
  - Added authenticated `GET /api/sessions/dashboard`.
  - For participants, returns only the caller's own upcoming bookings and history.
  - For coaches, returns own sessions with attendee details, sessions the coach is attending, and other coaches' sessions as busy periods without attendee data.

- Updated `web/app/participant/page.tsx`
  - Replaced the placeholder page with a usable participant dashboard.
  - Shows credit balance, upcoming own bookings, past/cancelled bookings, and available upcoming sessions.
  - Added Book and Cancel actions using the existing booking and enrolment cancellation endpoints.
  - Refreshes dashboard data after booking or cancellation.

- Updated `web/app/coach/page.tsx`
  - Replaced the placeholder page with a usable coach dashboard.
  - Shows credit balance, own upcoming sessions, allowed attendee details, sessions the coach is attending, and other coach busy periods.
  - Added Cancel Session action using the existing coach cancellation endpoint.

- Updated `web/app/globals.css`
  - Added simple responsive dashboard, panel, card, and button styles.

Why:
- The assignment demo needs participant and coach screens that visibly exercise the implemented booking/cancellation flows.
- Role-specific dashboard data avoids leaking other participant information to the browser.
- The UI stays intentionally simple and reuses the existing API/CSS patterns.

## Role Calendar Views

- Added `web/app/calendarTime.ts`
  - Centralized small `America/New_York` date/time formatting helpers.
  - Provides centre-local date keys and hours for calendar grouping without browser-local `getHours()`.

- Updated `web/app/participant/page.tsx`
  - Added a simple participant calendar section.
  - Shows only the signed-in participant's active upcoming bookings.
  - Displays session date, time, type, discipline, and room from already role-filtered dashboard data.

- Updated `web/app/coach/page.tsx`
  - Added a simple coach calendar section.
  - Shows own scheduled sessions, sessions the coach is attending, and other coach sessions as Busy entries.
  - Keeps other coaches' attendee and participant information out of the browser.

- Updated `web/app/admin/sessions/page.tsx`
  - Preserved the existing admin weekly grid.
  - Changed week labels and slot placement to use centre-local New York date/hour helpers instead of browser-local date methods.

- Updated `web/app/globals.css`
  - Added responsive list-calendar styles shared by participant and coach dashboards.

Why:
- The assignment demo needs each role to have a readable calendar view.
- Calendar placement must be based on centre-local time, not the user's browser timezone.
- Reusing the existing role-filtered dashboard data keeps permission filtering server-side.

## Verification

- Existing tests pass with `npm.cmd test`.
- Full build passes with `npm.cmd run build`.
- Migration verification passed on current database and a temporary fresh database.
