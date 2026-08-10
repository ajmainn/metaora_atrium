-- 004_data_integrity_followup.sql
-- Idempotent follow-up for databases that already applied the first 003 draft.

-- Active enrolments cannot remain on cancelled sessions.
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

-- Coaches cannot be active attendees in their own active sessions.
WITH invalid_enrolments AS (
  SELECT e.id, e.person_id, e.credits_charged, e.credits_refunded
  FROM enrolment e
  JOIN session s ON s.id = e.session_id
  WHERE e.status = 'active'
    AND s.status <> 'cancelled'
    AND e.person_id = s.coach_id
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
    AND e.person_id = s.coach_id
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
    AND e.person_id = s.coach_id
)
UPDATE enrolment e
SET
  status = 'cancelled',
  credits_refunded = credits_charged,
  cancelled_at = COALESCE(cancelled_at, enrolled_at)
WHERE e.id IN (SELECT id FROM invalid_enrolments);
