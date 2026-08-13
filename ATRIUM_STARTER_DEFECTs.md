# Atrium Starter Repository — Defects

## Purpose

This document lists the **confirmed defects found in the provided Atrium starter repository**.

For each confirmed defect, this document records:

* **Defect** — what is wrong.
* **How to find it** — the inspection, test, query, or reproduction method.
* **Where to find it** — the relevant starter file, route, schema area, or seeded data.
* **Why it is a defect** — the requirement or invariant that is violated.
* **How to solve it** — the recommended implementation or database correction.

\---

# 1\. Migration and Setup Defects

## DEFECT-01 — Fresh migration skips the base schema

**Defect:**  
On a clean database, the migration runner can mark `001\\\\\\\_init.sql` as already applied without actually executing it.

**How to find it:**

1. Create a completely empty PostgreSQL database.
2. Run the starter migration command.
3. Inspect `schema\\\\\\\_migrations`.
4. Check whether the base tables from `001\\\\\\\_init.sql` actually exist.
5. Review the migration runner logic that records `001\\\\\\\_init.sql`.

**Where to find it:**  
`scripts/migrate.mjs`, around lines 58–63.

**Why it is a defect:**  
A clean clone must be able to create the schema and seed data from scratch. Marking the base migration as applied before executing it causes later migrations to run against missing tables.

**How to solve it:**  
Make the migration runner execute every unapplied migration, including `001\\\\\\\_init.sql`, inside a transaction and record the migration only after it succeeds. Do not pre-mark the base migration on a fresh database.

**Severity:** Critical

\---

# 2\. Authentication and Access-Control Defects

## DEFECT-02 — People API leaks all users and credit balances

**Defect:**  
Any authenticated user can retrieve every person's email, role, credit balance, and active status.

**How to find it:**

1. Log in using a normal participant account.
2. Call `GET /api/people`.
3. Inspect the response.
4. Confirm that data belonging to unrelated participants/coaches is returned.

**Where to find it:**  
`api/src/routes/people.ts`, around lines 7–22.

**Why it is a defect:**  
Participants may see only their own bookings and credit balance. They must not receive information about other participants.

**How to solve it:**  
Enforce authorization in the API query itself. Restrict the full people list to administrators and create role-specific endpoints/query projections for participants and coaches.

**Severity:** Critical

\---

## DEFECT-03 — Session detail API leaks attendee information

**Defect:**  
Any authenticated user can retrieve the full attendee list, including names/emails, for a session.

**How to find it:**

1. Log in as a participant or an unrelated coach.
2. Request `GET /api/sessions/:id` for a session they do not own.
3. Inspect whether attendee names/emails are included.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 68–101.

**Why it is a defect:**  
Only the coach who owns the session and administrators may see participant-level attendee information. Other callers must not receive it.

**How to solve it:**  
Build the response according to the authenticated caller:

* Participant: only public session data plus their own booking state.
* Owning coach: full attendee list.
* Other coach: busy/session information without attendees.
* Administrator: full information.

Filtering must happen before the data reaches the browser.

**Severity:** Critical

\---

## DEFECT-04 — Any signed-in user can create a session for another coach

**Defect:**  
The API accepts a client-supplied `coach\\\\\\\_id` and only checks whether that person exists.

**How to find it:**

1. Log in as a participant.
2. Send a session-creation request containing another person's `coach\\\\\\\_id`.
3. Observe that the API does not bind the operation to the caller's identity/role.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 108–165.

**Why it is a defect:**  
A participant must not be able to book a room on behalf of another user or spend another coach's credits.

**How to solve it:**  
For coach-created sessions, derive `coach\\\\\\\_id` from the authenticated session rather than trusting request input. Allow administrators to act on behalf of another coach only through an explicitly authorized admin path.

**Severity:** Critical

\---

## DEFECT-05 — Any signed-in user can cancel any session

**Defect:**  
Session cancellation requires authentication but does not verify ownership or administrator authority.

**How to find it:**

1. Log in as a participant or unrelated coach.
2. Call the session cancellation endpoint for another coach's session.
3. Observe whether the cancellation proceeds.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 216–283.

**Why it is a defect:**  
Only the session's coach or an administrator should be able to cancel that coach's room/session.

**How to solve it:**  
Check the authenticated caller before entering the cancellation transaction. Permit cancellation only when the caller is the owning coach or an administrator.

**Severity:** Critical

\---

## DEFECT-06 — Session PATCH bypasses business rules and accounting

**Defect:**  
The generic PATCH route can directly change fields such as room, coach, status, start/end time, and other important data without applying booking rules or credit/refund logic.

**How to find it:**

1. Inspect the PATCH route.
2. Submit updates for `room\\\\\\\_id`, `coach\\\\\\\_id`, `starts\\\\\\\_at`, `ends\\\\\\\_at`, or `status`.
3. Check whether overlap, role, fee, refund, opening-hour, and credit rules are revalidated.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 172–209.

**Why it is a defect:**  
Direct updates can create invalid schedules, change ownership, bypass cancellation logic, and leave financial/accounting state inconsistent.

**How to solve it:**  
Replace unrestricted PATCH behavior with explicit, role-aware operations such as reschedule/cancel. Re-run all booking invariants and update credits/enrolments atomically.

**Severity:** Critical

\---

## DEFECT-07 — Passwords use unsalted SHA-256

**Defect:**  
Passwords are hashed using plain SHA-256.

**How to find it:**

1. Inspect the password hashing function.
2. Confirm it directly hashes the password with SHA-256 and no adaptive password-hashing algorithm.

**Where to find it:**  
`api/src/auth.ts`, around lines 13–15.

**Why it is a defect:**  
The assignment requires password hashing with a current password algorithm. SHA-256 is designed to be fast and is unsuitable for password storage.

**How to solve it:**  
Use an adaptive password-hashing algorithm such as Argon2id or bcrypt with an appropriate work factor. Migrate/reset seeded credentials as necessary.

**Severity:** High

\---

## DEFECT-08 — Application accepts a predictable default session secret

**Defect:**  
If `SESSION\\\\\\\_SECRET` is missing, authentication falls back to `change-me`.

**How to find it:**

1. Inspect the session-secret initialization.
2. Start the API without defining `SESSION\\\\\\\_SECRET`.
3. Confirm the server still starts using the fallback.

**Where to find it:**  
`api/src/auth.ts`, around lines 9–10, and `env.example`.

**Why it is a defect:**  
A known signing secret can allow forged session cookies if the application is deployed without overriding it.

**How to solve it:**  
Require `SESSION\\\\\\\_SECRET` at startup and fail fast when it is missing or obviously insecure. Keep a safe placeholder in `.env.example`, but never silently use it.

**Severity:** High

\---

## DEFECT-09 — Inactive users can authenticate

**Defect:**  
The login query does not reject accounts whose `active` flag is false.

**How to find it:**

1. Select an inactive seeded account.
2. Attempt login with its valid credentials.
3. Inspect the login query and verify that `active` is not part of the authorization condition.

**Where to find it:**  
`api/src/auth.ts`, around lines 61–89.

**Why it is a defect:**  
Inactive accounts should not receive valid authenticated sessions.

**How to solve it:**  
Require `active = true` during authentication and return a generic authentication failure for inactive accounts.

**Severity:** High

\---

# 3\. Session Booking and Scheduling Defects

## DEFECT-10 — Back-to-back sessions are incorrectly treated as overlapping

**Defect:**  
Room conflict logic uses inclusive comparison operators and rejects valid adjacent sessions.

**How to find it:**

1. Create or identify a session ending at 10:00.
2. Attempt to create another in the same room starting exactly at 10:00.
3. Observe the overlap rejection.
4. Inspect the comparison expression.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 132–140.

**Why it is a defect:**  
The assignment explicitly defines intervals as half-open. A session ending at 10:00 and another starting at 10:00 do not conflict.

**How to solve it:**  
Use half-open overlap logic:

`existing.starts\\\\\\\_at < new\\\\\\\_end AND existing.ends\\\\\\\_at > new\\\\\\\_start`

**Severity:** High

\---

## DEFECT-11 — Cancelled sessions continue blocking rooms

**Defect:**  
The room-clash query includes cancelled sessions.

**How to find it:**

1. Cancel a session.
2. Attempt to book the same room during the cancelled session's old time.
3. Inspect the conflict query to see whether cancelled status is excluded.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 132–140.

**Why it is a defect:**  
A cancelled session must release its room and stop counting against availability.

**How to solve it:**  
Exclude `cancelled` sessions from room-conflict checks and make the same rule consistent in database constraints and calendar queries.

**Severity:** High

\---

## DEFECT-12 — Session creation does not check person conflicts

**Defect:**  
Creating a session checks room availability but not whether the coach already has another teaching or attendee commitment.

**How to find it:**

1. Find a coach who is already teaching or attending another session.
2. Attempt to create a new overlapping session for that coach.
3. Inspect session-creation validation and confirm only room conflicts are checked.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 108–165.

**Why it is a defect:**  
Nobody may hold two overlapping commitments, whether teaching or attending.

**How to solve it:**  
Before creating/rescheduling, query both:

* sessions the person coaches, and
* active enrolments the person attends.

Reject any half-open interval overlap, including the full 210-minute room/commitment window for `INTENSIVE`.

**Severity:** High

\---

## DEFECT-13 — Opening hours and Sunday closure are not validated

**Defect:**  
Session creation accepts arbitrary start/end timestamps without validating centre opening hours.

**How to find it:**

1. Attempt to create a session before 07:00, after 21:00, or on Sunday in `America/New\\\\\\\_York`.
2. Observe that the API accepts the timestamps.
3. Inspect the creation route for centre-local validation.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 108–165.

**Why it is a defect:**  
The centre is open 07:00–21:00 Monday–Saturday and closed Sunday. A session must fit entirely inside those hours.

**How to solve it:**  
Convert/evaluate the proposed interval in `America/New\\\\\\\_York`, reject Sundays, and ensure the whole room-hold interval fits within 07:00–21:00.

**Severity:** High

\---

## DEFECT-14 — Coach 48-hour booking deadline is missing

**Defect:**  
A coach can create a room booking less than 48 hours before the session begins.

**How to find it:**

1. Attempt to create a session starting within the next 48 hours.
2. Inspect the creation route for a deadline check.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 108–165.

**Why it is a defect:**  
The assignment requires coaches to book rooms at least 48 hours before the session start.

**How to solve it:**  
Calculate absolute time until `starts\\\\\\\_at` and reject coach bookings with less than 48 hours' notice. Define any admin override explicitly if one is desired.

**Severity:** High

\---

## DEFECT-15 — `coach\\\\\\\_id` may reference a participant or administrator

**Defect:**  
The session route verifies only that the supplied person exists, not that the person is an active coach.

**How to find it:**

1. Select a participant/admin person ID.
2. Submit it as `coach\\\\\\\_id`.
3. Inspect the validation query.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 126–129.

**Why it is a defect:**  
Only coaches should be assigned as session coaches.

**How to solve it:**  
Require `person.kind = 'coach'` and `active = true`. Prefer binding normal coach creation to the authenticated coach identity.

**Severity:** High

\---

## DEFECT-16 — Coach credit balance can become negative

**Defect:**  
The room fee is deducted without first confirming that the coach has enough credits.

**How to find it:**

1. Use a coach with fewer credits than the room/session fee.
2. Create a session.
3. Inspect the resulting credit balance.
4. Review the deduction query.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 147–160.

**Why it is a defect:**  
Credits are the booking payment mechanism. A booking should not succeed without sufficient credits.

**How to solve it:**  
Check and deduct balance atomically inside the booking transaction. A conditional update such as `WHERE credits >= fee` can prevent race-condition overspending.

**Severity:** High

\---

## DEFECT-17 — Unknown session types are not validated cleanly

**Defect:**  
Fee helpers can return `0` for an unsupported session type, and later database behavior can become an internal error.

**How to find it:**

1. Send a session-creation request with an invalid `session\\\\\\\_type`.
2. Trace the fee helper.
3. Observe whether the API returns a controlled 400 response or produces zero pricing / a database failure.

**Where to find it:**  
`api/src/credits.ts`, around lines 13–18, and `api/src/routes/sessions.ts`.

**Why it is a defect:**  
Invalid client input should not become a free booking or an HTTP 500.

**How to solve it:**  
Validate `session\\\\\\\_type` at the API boundary against exactly `SHORT`, `STANDARD`, and `INTENSIVE`; return HTTP 400 for unknown values.

**Severity:** Medium

\---

# 4\. Cancellation, Refund and Concurrency Defects

## DEFECT-18 — Cancellation after session start can receive a refund

**Defect:**  
Refund notice calculation uses `Math.abs`, turning negative notice after a session starts into positive hours.

**How to find it:**

1. Inspect `hoursOfNotice`.
2. Test a cancellation timestamp after the session start.
3. Verify that the absolute difference can incorrectly enter a refund tier.

**Where to find it:**  
`api/src/credits.ts`, around lines 21–22, and cancellation code in `api/src/routes/sessions.ts`.

**Why it is a defect:**  
A cancellation after the session start must not be interpreted as advance notice.

**How to solve it:**  
Use signed time difference: `sessionStart - cancellationTime`. If it is zero or negative, refund should be zero unless an explicit exceptional policy applies.

**Severity:** High

\---

## DEFECT-19 — Coach cancellation incorrectly applies coach refund percentage to participants

**Defect:**  
When a coach cancels, participant refunds are calculated using the coach's room-fee refund tier.

**How to find it:**

1. Create a session with paid participants.
2. Cancel it at different notice periods.
3. Inspect participant refunds.
4. Trace the cancellation implementation.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 237–263.

**Why it is a defect:**  
The assignment explicitly says the participant has done nothing wrong when the coach cancels. Participant credits must be handled separately.

**How to solve it:**  
Refund **100% of each participant's paid credits** whenever the coach cancels the session, regardless of the coach's own room-fee refund tier.

**Severity:** High

\---

## DEFECT-20 — Concurrent cancellation requests can double-refund

**Defect:**  
The route reads session status before the transaction and does not lock/claim the cancellation before processing refunds.

**How to find it:**

1. Inspect the cancellation transaction order.
2. Send two cancellation requests simultaneously for the same active session.
3. Check whether both requests can observe the session as active and process refunds.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 224–271.

**Why it is a defect:**  
The same cancellation must not return credits twice.

**How to solve it:**  
Perform cancellation atomically. Lock the session row with `SELECT ... FOR UPDATE` or use a conditional status update inside the transaction, then refund only if the transaction successfully transitions the session from active/scheduled to cancelled.

**Severity:** High

\---

## DEFECT-21 — Concurrent session creation can double-book a room

**Defect:**  
Room availability is checked separately from the insert, with no database-level exclusion protection.

**How to find it:**

1. Inspect the create flow and schema.
2. Send two simultaneous requests for the same room/time.
3. Both requests may pass the initial clash query before either inserts.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 132–160, and the session schema.

**Why it is a defect:**  
One room may hold only one active session at a time.

**How to solve it:**  
Provide database-backed concurrency protection, for example:

* a PostgreSQL exclusion constraint on active room time ranges, or
* suitable transaction-level locking/serialization with conflict retry.

Application-only pre-checks are insufficient.

**Severity:** High

\---

# 5\. Schema Integrity Defects

## DEFECT-22 — Required domain columns are nullable

**Defect:**  
Many critical columns do not have `NOT NULL` constraints.

**How to find it:**

1. Inspect `CREATE TABLE` statements in `001\\\\\\\_init.sql`.
2. Identify required fields that lack `NOT NULL`.
3. Attempt inserting rows with missing domain-critical values.

**Where to find it:**  
`migrations/001\\\\\\\_init.sql`, person/room/session/enrolment/check-in definitions.

**Why it is a defect:**  
The application assumes values such as email, password hash, kind, room/session identifiers, timestamps, and credit fields exist. Null values can create unusable/invalid records.

**How to solve it:**  
Clean existing invalid data first, then add `NOT NULL` constraints to fields that are mandatory by the domain.

**Severity:** High

\---

## DEFECT-23 — Session and enrolment statuses are unconstrained

**Defect:**  
The database accepts arbitrary strings for `session.status` and `enrolment.status`.

**How to find it:**

1. Inspect the schema and hardening migrations.
2. Attempt to insert/update an unsupported status string.
3. Verify that the database accepts it.

**Where to find it:**  
`migrations/001\\\\\\\_init.sql` and the existing schema-hardening migration.

**Why it is a defect:**  
Application logic depends on exact status values. Typos or arbitrary values can bypass filters and accounting rules.

**How to solve it:**  
Add CHECK constraints or PostgreSQL enums for the permitted status values after normalizing existing rows.

**Severity:** Medium

\---

# 6\. Unified Login and Frontend Defects

## DEFECT-24 — Unified login always redirects to `/admin`

**Defect:**  
Successful login sends every role to the administrator area.

**How to find it:**

1. Log in as a participant.
2. Log in as a coach.
3. Observe that both are redirected to `/admin`.
4. Inspect the success handler.

**Where to find it:**  
`web/app/login/page.tsx`, around lines 23–24.

**Why it is a defect:**  
The assignment requires one login form whose destination and dashboard are resolved from the authenticated person's role.

**How to solve it:**  
Return authenticated user/role information from login/session state and redirect to the correct role dashboard. Protect each route server/API-side as well.

**Severity:** High

\---

## DEFECT-25 — Client-side API base URL uses a non-public Next.js environment variable

**Defect:**  
Browser components read `process.env.API\\\\\\\_BASE\\\\\\\_URL`.

**How to find it:**

1. Inspect client components.
2. Build/run in an environment where the API is not on `localhost:4000`.
3. Observe that non-`NEXT\\\\\\\_PUBLIC\\\\\\\_` values are unavailable in browser code.

**Where to find it:**  
`web/app/login/page.tsx`, `web/app/admin/page.tsx`, `web/app/admin/sessions/page.tsx`.

**Why it is a defect:**  
The frontend can silently fall back to localhost and call the wrong API when deployed.

**How to solve it:**  
Use a browser-exposed configuration such as `NEXT\\\\\\\_PUBLIC\\\\\\\_API\\\\\\\_BASE\\\\\\\_URL`, or proxy API calls through Next.js server routes so client code does not need the backend URL.

**Severity:** Medium

\---

## DEFECT-26 — Calendar date calculations are not centre-timezone/DST safe

**Defect:**  
Calendar code uses the browser/server local timezone and fixed `24 \\\\\\\* 60 \\\\\\\* 60 \\\\\\\* 1000` day arithmetic.

**How to find it:**

1. Inspect week/day calculations.
2. Test around the New York DST transitions, including 1 November 2026.
3. Compare calculated day boundaries with `America/New\\\\\\\_York`.

**Where to find it:**  
`web/app/admin/sessions/page.tsx`, around lines 46–77; `web/app/admin/page.tsx`, around lines 11–25.

**Why it is a defect:**  
The assignment requires centre-local time. DST days can be 23 or 25 hours, so adding a fixed 24 hours gives incorrect windows.

**How to solve it:**  
Construct calendar boundaries in `America/New\\\\\\\_York` using a timezone-aware library/API, then convert boundary instants to UTC for database queries. Never derive the next local midnight by adding 24 hours.

**Severity:** High

\---

## DEFECT-27 — Admin coach selector includes non-coaches

**Defect:**  
The create-session form loads all people and displays them as possible coaches.

**How to find it:**

1. Open the admin session creation form.
2. Inspect the coach dropdown.
3. Confirm participants/admins appear.
4. Inspect the people-loading/filter logic.

**Where to find it:**  
`web/app/admin/sessions/page.tsx`, around lines 93–95 and 223–229.

**Why it is a defect:**  
The UI allows invalid coach assignments and can submit them to the API.

**How to solve it:**  
Populate the selector only with active users whose role/kind is `coach`. The API must independently enforce the same rule.

**Severity:** Medium

\---

## DEFECT-28 — Empty date/time can crash the admin create form

**Defect:**  
Empty input can produce `new Date('T')`, then `toISOString()` throws before the API request.

**How to find it:**

1. Leave date/time fields empty.
2. Submit the form.
3. Observe the client-side exception.
4. Inspect date construction.

**Where to find it:**  
`web/app/admin/sessions/page.tsx`, around lines 110–124.

**Why it is a defect:**  
Invalid user input should produce a controlled validation message, not a runtime crash.

**How to solve it:**  
Validate required date/time fields before constructing a `Date`. Check parsing success and display field-level/form-level errors.

**Severity:** Low

\---

## DEFECT-29 — Frontend treats failed fetch responses as successful data

**Defect:**  
Admin pages call `res.json()` and store the result without checking `res.ok`.

**How to find it:**

1. Cause the API to return 401 or 500.
2. Load the admin pages.
3. Observe whether an error object is handled as though it were an array.
4. Inspect fetch handling.

**Where to find it:**  
`web/app/admin/page.tsx`, around lines 27–40; `web/app/admin/sessions/page.tsx`, around lines 76–95.

**Why it is a defect:**  
Error objects can reach array-rendering logic and produce broken UI state or additional runtime errors.

**How to solve it:**  
Check `res.ok`, distinguish unauthorized/error/empty states, validate response shape, and render clear loading/error UI.

**Severity:** Medium

\---

## DEFECT-30 — Public page lacks fetch failure handling

**Defect:**  
The starter public page assumes the session API always returns a valid array.

**How to find it:**

1. Stop the API or force an API error.
2. Load the public page.
3. Observe server-render or page failure.
4. Inspect the page's fetch logic.

**Where to find it:**  
`web/app/page.tsx`, around lines 23–27.

**Why it is a defect:**  
The mandatory public page should remain usable and show an appropriate error state when data cannot be loaded.

**How to solve it:**  
Catch network failures, check response status, validate the payload, and show intentional loading/empty/error states.

**Severity:** Medium

\---

## DEFECT-31 — Visible mojibake/corrupted punctuation appears in UI/docs

**Defect:**  
Some user-visible strings contain encoding artifacts such as `â€“` and `â€”`.

**How to find it:**

1. Search the repository for `â`.
2. Open affected pages/documentation.
3. Verify the corrupted characters are visible.

**Where to find it:**  
`web/app/page.tsx`, around line 52; `web/app/admin/sessions/page.tsx`, around line 162; and affected documentation.

**Why it is a defect:**  
The UI shows corrupted text rather than intended punctuation.

**How to solve it:**  
Replace corrupted text with valid UTF-8 characters, ensure files are saved as UTF-8, and verify page/document encoding.

**Severity:** Low

\---

# 7\. Database Performance / Indexing Defects

## DEFECT-32 — Session feed performs N+1 database queries

**Defect:**  
The session-list route loads the base session rows and then separately queries room, coach, and enrolment count for every session.

**How to find it:**

1. Inspect the session feed loop.
2. Count SQL calls for `N` returned sessions.
3. Observe approximately `1 + 3N` query behavior.
4. Run `EXPLAIN (ANALYZE, BUFFERS)` on the relevant query patterns before optimizing.

**Where to find it:**  
`api/src/routes/sessions.ts`, around lines 37–59.

**Why it is a defect:**  
Query count grows linearly with the number of sessions and can make catalogue/calendar endpoints unnecessarily slow.

**How to solve it:**  
Replace per-session queries with one joined/aggregated query (for example joins plus an enrolment count grouped by session). Add or adjust indexes only after checking the resulting query plan.

For the README, preserve:

* `EXPLAIN (ANALYZE, BUFFERS)` before optimization.
* The optimized query.
* `EXPLAIN (ANALYZE, BUFFERS)` after optimization.
* A short explanation of the change in query count/plan.

**Severity:** Medium

\---

# 8\. Seed Data Defects

## DEFECT-33 — Fractional enrolment credit values exist

**Defect:**  
Seed data contains enrolments whose charged/refunded credit values are fractional.

**How to find it:**
Run a query that looks for non-integer enrolment credits, for example:

```sql
SELECT id, credits\\\\\\\_charged, credits\\\\\\\_refunded
FROM enrolment
WHERE credits\\\\\\\_charged <> trunc(credits\\\\\\\_charged)
   OR credits\\\\\\\_refunded <> trunc(credits\\\\\\\_refunded);
```

The audit identified enrolments including:

`612, 901, 1494, 1983, 2243, 2483`

**Where to find it:**  
Seeded enrolment rows from `migrations/001\\\\\\\_init.sql`.

**Why it is a defect:**  
The assignment states that credits are always integers and never floating point.

**How to solve it:**  
Choose and document a deliberate rounding rule, repair existing fractional values through a migration, and add schema constraints that prevent fractional credit values from being stored again.

**Severity:** High

\---

## DEFECT-34 — Session 83 exceeds room capacity

**Defect:**  
Session `83` has 11 active enrolments while its room capacity is 8.

**How to find it:**
Run a capacity audit joining sessions, rooms, and active enrolments:

```sql
SELECT
    s.id AS session\\\\\\\_id,
    r.capacity,
    COUNT(e.id) AS active\\\\\\\_enrolments
FROM session s
JOIN room r ON r.id = s.room\\\\\\\_id
LEFT JOIN enrolment e
    ON e.session\\\\\\\_id = s.id
   AND e.status = 'active'
WHERE s.status <> 'cancelled'
GROUP BY s.id, r.capacity
HAVING COUNT(e.id) > r.capacity;
```

**Where to find it:**  
Seeded data from `migrations/001\\\\\\\_init.sql`; confirmed session `83`.

**Why it is a defect:**  
Room capacity counts participants and may not be exceeded.

**How to solve it:**  
Repair the seeded over-capacity state in a migration by cancelling/refunding excess enrolments according to a deterministic documented rule. Then enforce capacity in participant booking transactions with concurrency-safe locking/checking.

**Severity:** High

\---

## DEFECT-35 — Coach is enrolled in their own session

**Defect:**  
Coach/person `28` is actively enrolled in session `639`, which they coach. The enrolment is `1928`.

**How to find it:**

```sql
SELECT
    e.id AS enrolment\\\\\\\_id,
    e.session\\\\\\\_id,
    e.person\\\\\\\_id,
    s.coach\\\\\\\_id
FROM enrolment e
JOIN session s ON s.id = e.session\\\\\\\_id
WHERE e.status = 'active'
  AND e.person\\\\\\\_id = s.coach\\\\\\\_id;
```

**Where to find it:**  
Seeded data from `migrations/001\\\\\\\_init.sql`; session `639`, person `28`, enrolment `1928`.

**Why it is a defect:**  
The assignment explicitly states that a coach may not enrol in their own session.

**How to solve it:**  
Cancel/refund the invalid seeded enrolment and add application/database protection preventing an active enrolment where `person\\\\\\\_id = session.coach\\\\\\\_id`.

**Severity:** High

\---

## DEFECT-36 — Active enrolments remain on cancelled sessions

**Defect:**  
Cancelled sessions still have active enrolments.

Confirmed affected enrolments:

`504, 585, 1598, 1659, 2617`

**How to find it:**

```sql
SELECT e.id, e.session\\\\\\\_id, e.person\\\\\\\_id
FROM enrolment e
JOIN session s ON s.id = e.session\\\\\\\_id
WHERE e.status = 'active'
  AND s.status = 'cancelled';
```

**Where to find it:**  
Seeded database originating from `migrations/001\\\\\\\_init.sql` and visible during schema-hardening/audit work.

**Why it is a defect:**  
A cancelled session stops counting against the system; participants should not remain actively booked into it.

**How to solve it:**  
Use a repair migration to mark affected enrolments cancelled, set cancellation timestamps consistently, and fully refund participant credits where the coach/session cancellation caused the cancellation. Future session cancellation must update session and affected enrolments atomically.

**Severity:** High

\---

## DEFECT-37 — Check-ins exist for cancelled sessions

**Defect:**  
Check-in records exist for enrolments tied to cancelled sessions.

Confirmed check-ins:

`404, 605, 1692, 1743`

**How to find it:**

```sql
SELECT
    c.id AS check\\\\\\\_in\\\\\\\_id,
    c.enrolment\\\\\\\_id,
    e.session\\\\\\\_id,
    s.status
FROM check\\\\\\\_in c
JOIN enrolment e ON e.id = c.enrolment\\\\\\\_id
JOIN session s ON s.id = e.session\\\\\\\_id
WHERE s.status = 'cancelled';
```

**Where to find it:**  
Seeded database from `migrations/001\\\\\\\_init.sql`.

**Why it is a defect:**  
A cancelled session should not have valid attendance/check-in records.

**How to solve it:**  
Remove invalid check-ins in a repair migration and ensure cancellation/attendance write paths prevent check-in records for cancelled sessions.

**Severity:** Medium

\---

## DEFECT-38 — Seed data contains overlapping commitments for person 28

**Defect:**  
Person `28` is scheduled in two overlapping commitments:

* Coaches session `302`: `2026-10-06T21:45Z` → `22:45Z`
* Attends session `503`: `2026-10-06T21:30Z` → `2026-10-07T01:00Z`

**How to find it:**

1. Build a combined set of each person's coaching commitments and active enrolment commitments.
2. Self-join commitments for the same person.
3. Use half-open overlap logic:

```text
A.start < B.end AND A.end > B.start
```

4. Exclude cancelled sessions/inactive enrolments.
5. Inspect the returned conflicts.

**Where to find it:**  
Seeded data from `migrations/001\\\\\\\_init.sql`; person `28`, sessions `302` and `503`.

**Why it is a defect:**  
The assignment states that nobody can be in two rooms at once, whether they are coaching or attending.

**How to solve it:**  
Repair the conflicting seeded commitment deterministically through a migration, then enforce person-conflict checks on all booking/reschedule paths. The check must include both coaching and attendee commitments and must respect half-open intervals.

**Severity:** High

\---



# Defect Summary

|Category|Count|
|-|-:|
|Migration/setup|1|
|Authentication/access control|8|
|Session booking/scheduling|8|
|Cancellation/refund/concurrency|4|
|Schema integrity|2|
|Frontend/login/timezone|8|
|Database performance/indexing|1|
|Seed data|6|
|**Total confirmed starter defects**|**38**|

\---

# 

