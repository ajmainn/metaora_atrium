-- Anonymous visitor bookings create a participant account before the visitor has
-- established a password. The password hash is set only after a single-use
-- setup token is presented.
ALTER TABLE person
  ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE password_setup_token (
  id          serial primary key,
  person_id   integer not null references person(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

CREATE INDEX idx_password_setup_token_person_active
  ON password_setup_token (person_id, expires_at)
  WHERE used_at IS NULL;
