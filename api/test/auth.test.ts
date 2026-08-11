import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSession,
  sessionCookieSecurityOptions,
  signSession,
  verifyPassword
} from '../src/auth';

test('a session cookie round trips and a tampered one is rejected', () => {
  process.env.SESSION_SECRET = 'atrium-test-secret';

  const issuedAt = Date.now();
  const cookie = signSession(41, issuedAt);
  const session = readSession(cookie);

  assert.notEqual(session, null);
  assert.equal(session ? session.personId : null, 41);
  assert.equal(session ? session.issuedAt : null, issuedAt);

  assert.equal(readSession(`42.${issuedAt}.${cookie.split('.')[2]}`), null);
  assert.equal(readSession('41'), null);
  assert.equal(readSession(undefined), null);
});

test('session cookies are secure only in production', () => {
  const previous = process.env.NODE_ENV;

  process.env.NODE_ENV = 'development';
  assert.equal(sessionCookieSecurityOptions().secure, false);

  process.env.NODE_ENV = 'production';
  assert.equal(sessionCookieSecurityOptions().secure, true);

  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
});

test('development migrations provide valid scrypt credentials for all roles', () => {
  const credentials = [
    ['admin', 'scrypt$16384$8$1$atrium-dev-admin$3258f807389998c45e4dc085e27522630c993fe8a8ff0c3ee234280c98d0722e67cdb3fe3ad1302774e0691e529e7ccfc10c515a8afe273ae94edb607f1b665f'],
    ['coach123', 'scrypt$16384$8$1$atrium-dev-coach-oscar$de9c0063a1ca69c98a6703a09d19a779aefe78e62f3bdc100a59d86630ef325c5c321dde77cf09105d92c95bb3a15194bc813bcaa1135e9bfb6641d5cfd062b1'],
    ['participant123', 'scrypt$16384$8$1$atrium-dev-participant-sofia$e6ff921e57ddf69f96777ce73895f1b45a454b548b45f215a45fa8588f0b1da0b47b26d96bc2417db0ec3f92ed080dc2356942ab5f5b7560880b334e15344dfe']
  ];

  for (const [password, hash] of credentials) {
    assert.equal(verifyPassword(password, hash), true);
    assert.equal(verifyPassword('wrong', hash), false);
  }
});
