-- Restore seeded check-ins removed by earlier cleanup migrations.
-- Invalid historical events remain auditable but do not count as attendance.

ALTER TABLE check_in
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN void_reason text;

ALTER TABLE check_in
  DROP CONSTRAINT uq_check_in_enrolment;

INSERT INTO check_in (id, enrolment_id, checked_in_at, voided_at, void_reason)
VALUES
  (268, 1600, '2026-12-23 21:31:00+00', CURRENT_TIMESTAMP, 'enrolment cancelled: seeded session exceeded room capacity'),
  (315, 2369, '2026-12-23 21:41:00+00', CURRENT_TIMESTAMP, 'enrolment cancelled: seeded session exceeded room capacity'),
  (404, 504, '2026-09-15 12:16:00+00', CURRENT_TIMESTAMP, 'enrolment cancelled with seeded session'),
  (605, 585, '2026-09-29 19:13:00+00', CURRENT_TIMESTAMP, 'enrolment cancelled with seeded session'),
  (1127, 292, '2026-12-23 21:34:00+00', CURRENT_TIMESTAMP, 'enrolment cancelled: seeded session exceeded room capacity'),
  (1251, 1058, '2026-12-17 16:34:00+00', CURRENT_TIMESTAMP, 'duplicate seeded check-in; earlier event retained as valid'),
  (1692, 1598, '2026-12-04 13:42:00+00', CURRENT_TIMESTAMP, 'enrolment cancelled with seeded session'),
  (1741, 1928, '2026-09-19 19:59:00+00', CURRENT_TIMESTAMP, 'invalid seeded coach self-enrolment'),
  (1743, 2617, '2026-12-04 13:42:00+00', CURRENT_TIMESTAMP, 'enrolment cancelled with seeded session')
ON CONFLICT (id) DO UPDATE
SET enrolment_id = EXCLUDED.enrolment_id,
    checked_in_at = EXCLUDED.checked_in_at,
    voided_at = EXCLUDED.voided_at,
    void_reason = EXCLUDED.void_reason;

ALTER TABLE check_in
  ADD CONSTRAINT chk_check_in_void_metadata
  CHECK (
    (voided_at IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)
  );

CREATE UNIQUE INDEX uq_check_in_enrolment
  ON check_in (enrolment_id)
  WHERE voided_at IS NULL;
