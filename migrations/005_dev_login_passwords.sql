-- 005_dev_login_passwords.sql
-- Known development passwords for manual role-login testing.
-- Coach Oscar: coach123
-- Participant Sofia: participant123

UPDATE person
SET password_hash = 'scrypt$16384$8$1$atrium-dev-coach-oscar$de9c0063a1ca69c98a6703a09d19a779aefe78e62f3bdc100a59d86630ef325c5c321dde77cf09105d92c95bb3a15194bc813bcaa1135e9bfb6641d5cfd062b1'
WHERE email = 'oscar.lindqvist@atrium.local'
  AND kind = 'coach'
  AND active = true;

UPDATE person
SET password_hash = 'scrypt$16384$8$1$atrium-dev-participant-sofia$e6ff921e57ddf69f96777ce73895f1b45a454b548b45f215a45fa8588f0b1da0b47b26d96bc2417db0ec3f92ed080dc2356942ab5f5b7560880b334e15344dfe'
WHERE email = 'sofia.marino@atrium.local'
  AND kind = 'participant'
  AND active = true;
