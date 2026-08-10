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

## Verification

- Existing tests pass with `npm.cmd test`.
- Full build passes with `npm.cmd run build`.
- Migration verification passed on current database and a temporary fresh database.
