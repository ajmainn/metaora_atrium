-- 002_schema_hardening.sql
-- Repair confirmed starter-data defects and add safe protections.

-- =========================================================
-- DEFECT-01: Fractional person credit balances
-- Atrium credits must be whole integers.
-- =========================================================

UPDATE person
SET credits = ROUND(credits)
WHERE credits <> TRUNC(credits);

ALTER TABLE person
ADD CONSTRAINT chk_person_credits_integer
CHECK (credits = TRUNC(credits));


-- =========================================================
-- DEFECT-02: Fractional session fees
-- Restore the documented fixed fees for each session type.
-- =========================================================

UPDATE session
SET room_fee_credits =
    CASE session_type
        WHEN 'short' THEN 30
        WHEN 'standard' THEN 40
        WHEN 'intensive' THEN 120
    END,
    seat_fee_credits =
    CASE session_type
        WHEN 'short' THEN 15
        WHEN 'standard' THEN 20
        WHEN 'intensive' THEN 60
    END
WHERE room_fee_credits <> TRUNC(room_fee_credits)
   OR seat_fee_credits <> TRUNC(seat_fee_credits);

ALTER TABLE session
ADD CONSTRAINT chk_session_room_fee_integer
CHECK (room_fee_credits = TRUNC(room_fee_credits));

ALTER TABLE session
ADD CONSTRAINT chk_session_seat_fee_integer
CHECK (seat_fee_credits = TRUNC(seat_fee_credits));


-- =========================================================
-- DEFECT-03: Incorrect intensive-session durations
-- Intensive sessions must occupy 210 minutes.
-- =========================================================

UPDATE session
SET ends_at = starts_at + INTERVAL '210 minutes'
WHERE id IN (142, 749);

ALTER TABLE session
ADD CONSTRAINT chk_session_duration
CHECK (
    (session_type = 'short'
        AND ends_at = starts_at + INTERVAL '45 minutes')
 OR (session_type = 'standard'
        AND ends_at = starts_at + INTERVAL '60 minutes')
 OR (session_type = 'intensive'
        AND ends_at = starts_at + INTERVAL '210 minutes')
);


-- =========================================================
-- DEFECT-04: Duplicate check-in
-- Keep the first check-in and remove the duplicate.
-- =========================================================

DELETE FROM check_in
WHERE id = 1251;

ALTER TABLE check_in
ADD CONSTRAINT uq_check_in_enrolment
UNIQUE (enrolment_id);


-- =========================================================
-- DEFECT-05: Two sessions overlap in the same room.
-- Cancel the later conflicting seeded session.
-- =========================================================

UPDATE session
SET status = 'cancelled'
WHERE id = 617;


-- =========================================================
-- DEFECT-06: Same coach has overlapping sessions.
-- Cancel the later conflicting seeded session.
-- =========================================================

UPDATE session
SET status = 'cancelled'
WHERE id = 557;


-- =========================================================
-- Basic validation for future records
-- =========================================================

ALTER TABLE person
ADD CONSTRAINT chk_person_kind
CHECK (kind IN ('participant', 'coach', 'admin'));

ALTER TABLE session
ADD CONSTRAINT chk_session_type
CHECK (session_type IN ('short', 'standard', 'intensive'));

ALTER TABLE session
ADD CONSTRAINT chk_session_time_order
CHECK (ends_at > starts_at);