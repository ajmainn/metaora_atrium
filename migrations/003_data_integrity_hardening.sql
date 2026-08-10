-- 003_data_integrity_hardening.sql
-- Repair remaining confirmed starter-data defects and add basic data guards.

-- =========================================================
-- DEFECT-07: Fractional enrolment credit values
-- Atrium credits must be whole integers everywhere.
-- =========================================================

UPDATE enrolment
SET
  credits_charged = ROUND(credits_charged),
  credits_refunded = ROUND(credits_refunded)
WHERE credits_charged <> TRUNC(credits_charged)
   OR credits_refunded <> TRUNC(credits_refunded);


-- =========================================================
-- DEFECT-08: Active enrolments remain on cancelled sessions
-- DEFECT-09: Check-ins are associated with cancelled sessions
-- Cancel the invalid enrolments and refund any unrefunded charge.
-- =========================================================

WITH refund_totals AS (
  SELECT e.person_id, SUM(e.credits_charged - e.credits_refunded) AS amount
  FROM enrolment e
  JOIN session s ON s.id = e.session_id
  WHERE e.status = 'active'
    AND s.status = 'cancelled'
  GROUP BY e.person_id
)
UPDATE person p
SET credits = p.credits + refund_totals.amount
FROM refund_totals
WHERE p.id = refund_totals.person_id;

UPDATE enrolment e
SET
  status = 'cancelled',
  credits_refunded = credits_charged,
  cancelled_at = COALESCE(cancelled_at, enrolled_at)
FROM session s
WHERE s.id = e.session_id
  AND e.status = 'active'
  AND s.status = 'cancelled';

DELETE FROM check_in ci
USING enrolment e, session s
WHERE ci.enrolment_id = e.id
  AND e.session_id = s.id
  AND s.status = 'cancelled';


-- =========================================================
-- DEFECT-10: Session 83 is over capacity
-- Keep the earliest valid active enrolments up to room capacity.
-- =========================================================

WITH ranked AS (
  SELECT e.id, e.person_id, e.credits_charged, e.credits_refunded
  FROM enrolment e
  JOIN session s ON s.id = e.session_id
  JOIN room r ON r.id = s.room_id
  WHERE e.session_id = 83
    AND e.status = 'active'
    AND s.status <> 'cancelled'
  ORDER BY e.enrolled_at, e.id
  OFFSET (SELECT capacity FROM room WHERE id = (SELECT room_id FROM session WHERE id = 83))
),
refund_totals AS (
  SELECT person_id, SUM(credits_charged - credits_refunded) AS amount
  FROM ranked
  GROUP BY person_id
)
UPDATE person p
SET credits = p.credits + refund_totals.amount
FROM refund_totals
WHERE p.id = refund_totals.person_id;

WITH ranked AS (
  SELECT
    e.id,
    ROW_NUMBER() OVER (ORDER BY e.enrolled_at, e.id) AS rn,
    r.capacity
  FROM enrolment e
  JOIN session s ON s.id = e.session_id
  JOIN room r ON r.id = s.room_id
  WHERE e.session_id = 83
    AND e.status = 'active'
    AND s.status <> 'cancelled'
),
excess AS (
  SELECT id
  FROM ranked
  WHERE rn > capacity
)
DELETE FROM check_in ci
USING excess
WHERE ci.enrolment_id = excess.id;

WITH ranked AS (
  SELECT
    e.id,
    ROW_NUMBER() OVER (ORDER BY e.enrolled_at, e.id) AS rn,
    r.capacity
  FROM enrolment e
  JOIN session s ON s.id = e.session_id
  JOIN room r ON r.id = s.room_id
  WHERE e.session_id = 83
    AND e.status = 'active'
    AND s.status <> 'cancelled'
),
excess AS (
  SELECT id
  FROM ranked
  WHERE rn > capacity
)
UPDATE enrolment e
SET
  status = 'cancelled',
  credits_refunded = credits_charged,
  cancelled_at = COALESCE(cancelled_at, enrolled_at)
WHERE e.id IN (SELECT id FROM excess);


-- =========================================================
-- DEFECT-11: Coach self-enrolment on session 639
-- DEFECT-12: Overlapping commitment for person 28
-- Cancel the invalid attendee commitments and refund any unrefunded charge.
-- =========================================================

WITH invalid_enrolments AS (
  SELECT e.id, e.person_id, e.credits_charged, e.credits_refunded
  FROM enrolment e
  JOIN session s ON s.id = e.session_id
  WHERE e.status = 'active'
    AND s.status <> 'cancelled'
    AND (
      (e.session_id = 639 AND e.person_id = s.coach_id)
      OR e.id = 917
    )
),
refund_totals AS (
  SELECT person_id, SUM(credits_charged - credits_refunded) AS amount
  FROM invalid_enrolments
  GROUP BY person_id
)
UPDATE person p
SET credits = p.credits + refund_totals.amount
FROM refund_totals
WHERE p.id = refund_totals.person_id;

WITH invalid_enrolments AS (
  SELECT e.id
  FROM enrolment e
  JOIN session s ON s.id = e.session_id
  WHERE e.status = 'active'
    AND s.status <> 'cancelled'
    AND (
      (e.session_id = 639 AND e.person_id = s.coach_id)
      OR e.id = 917
    )
)
DELETE FROM check_in ci
USING invalid_enrolments
WHERE ci.enrolment_id = invalid_enrolments.id;

WITH invalid_enrolments AS (
  SELECT e.id
  FROM enrolment e
  JOIN session s ON s.id = e.session_id
  WHERE e.status = 'active'
    AND s.status <> 'cancelled'
    AND (
      (e.session_id = 639 AND e.person_id = s.coach_id)
      OR e.id = 917
    )
)
UPDATE enrolment e
SET
  status = 'cancelled',
  credits_refunded = credits_charged,
  cancelled_at = COALESCE(cancelled_at, enrolled_at)
WHERE e.id IN (SELECT id FROM invalid_enrolments);


-- =========================================================
-- Basic validation for future records
-- =========================================================

ALTER TABLE person
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN password_hash SET NOT NULL,
  ALTER COLUMN full_name SET NOT NULL,
  ALTER COLUMN kind SET NOT NULL,
  ALTER COLUMN credits SET NOT NULL,
  ALTER COLUMN active SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE room
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN capacity SET NOT NULL;

ALTER TABLE session
  ALTER COLUMN room_id SET NOT NULL,
  ALTER COLUMN coach_id SET NOT NULL,
  ALTER COLUMN discipline SET NOT NULL,
  ALTER COLUMN session_type SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN starts_at SET NOT NULL,
  ALTER COLUMN ends_at SET NOT NULL,
  ALTER COLUMN room_fee_credits SET NOT NULL,
  ALTER COLUMN seat_fee_credits SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE enrolment
  ALTER COLUMN session_id SET NOT NULL,
  ALTER COLUMN person_id SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN credits_charged SET NOT NULL,
  ALTER COLUMN credits_refunded SET NOT NULL,
  ALTER COLUMN enrolled_at SET NOT NULL;

ALTER TABLE check_in
  ALTER COLUMN enrolment_id SET NOT NULL,
  ALTER COLUMN checked_in_at SET NOT NULL;

ALTER TABLE room
ADD CONSTRAINT chk_room_capacity_positive
CHECK (capacity > 0);

ALTER TABLE session
ADD CONSTRAINT chk_session_status
CHECK (status IN ('scheduled', 'completed', 'cancelled'));

ALTER TABLE enrolment
ADD CONSTRAINT chk_enrolment_status
CHECK (status IN ('active', 'cancelled'));

ALTER TABLE enrolment
ADD CONSTRAINT chk_enrolment_credits_charged_integer
CHECK (credits_charged = TRUNC(credits_charged));

ALTER TABLE enrolment
ADD CONSTRAINT chk_enrolment_credits_refunded_integer
CHECK (credits_refunded = TRUNC(credits_refunded));

CREATE UNIQUE INDEX uq_enrolment_one_active_per_session_person
  ON enrolment (session_id, person_id)
  WHERE status = 'active';
