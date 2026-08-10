# Changes

## Coach Session Cancellation Refunds

What changed:
- Added `api/src/sessionCancellation.ts` to centralize coach cancellation refund updates.
- Updated `POST /api/sessions/:id/cancel` to use that transactional cancellation helper.
- Changed participant refunds on coach cancellation to always refund 100% of each active enrolment's `credits_charged`.
- Kept coach room-fee refunds on the existing tiered notice policy: 100%, 50%, 25%, or 0%.
- Added `api/test/sessionCancellation.test.ts` covering all coach cancellation tiers and participant full refunds.
- Updated `api/package.json` so the new cancellation tests run with the API test suite.

Why:
- The assignment requires participants to be made whole when the coach cancels because the participant did nothing wrong.
- The previous flow incorrectly applied the coach's notice-based refund percentage to participant enrolments.
- Centralizing the logic made it testable while preserving the existing transactional route behavior.

## Coach/Admin Session Creation Validations

What changed:
- Added `api/src/sessionCreation.ts` for session booking-domain validation and atomic creation.
- Updated `POST /api/sessions` to run booking creation in a serializable transaction.
- Added 48-hour minimum booking notice validation.
- Added Monday-Saturday and 07:00-21:00 `America/New_York` centre-hours validation.
- Added exact duration validation for `short`, `standard`, and `intensive` sessions.
- Fixed overlap checks to use half-open interval logic: `existing.start < new.end AND existing.end > new.start`.
- Added scheduled-room conflict checks.
- Added coach commitment conflict checks for both teaching and active participant enrolments.
- Ignored cancelled sessions and cancelled enrolments for conflict checks.
- Added coach credit validation, coach row locking, and guarded credit deduction to prevent negative balances.
- Extended `api/src/db.ts` so callers can request transaction isolation level.
- Added `api/test/sessionCreation.test.ts` covering the required validation cases.
- Updated `api/package.json` so the creation tests run with the API test suite.

Why:
- The assignment booking rules must be enforced at the API, not only by UI behavior or database constraints.
- Session creation previously checked only basic room/coach existence and used closed overlap bounds, which could reject valid adjacent bookings and miss other domain conflicts.
- Credit deduction needed to be part of the same concurrency-safe transaction as validation and insertion.
