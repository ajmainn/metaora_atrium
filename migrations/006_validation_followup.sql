-- Safe validation required by login and credit accounting.

-- Upgrade the existing development administrator without changing its
-- documented local password. This migration also reaches databases where 005
-- was already applied.
-- Administrator: admin
UPDATE person
SET password_hash = 'scrypt$16384$8$1$atrium-dev-admin$3258f807389998c45e4dc085e27522630c993fe8a8ff0c3ee234280c98d0722e67cdb3fe3ad1302774e0691e529e7ccfc10c515a8afe273ae94edb607f1b665f'
WHERE email = 'admin@atrium.local'
  AND kind = 'admin'
  AND active = true;

CREATE UNIQUE INDEX uq_person_email_case_insensitive
  ON person (LOWER(email));

ALTER TABLE person
ADD CONSTRAINT chk_person_credits_nonnegative
CHECK (credits >= 0);

ALTER TABLE session
ADD CONSTRAINT chk_session_fees_nonnegative
CHECK (room_fee_credits >= 0 AND seat_fee_credits >= 0);

ALTER TABLE enrolment
ADD CONSTRAINT chk_enrolment_refund_range
CHECK (
  credits_charged >= 0
  AND credits_refunded >= 0
  AND credits_refunded <= credits_charged
);
