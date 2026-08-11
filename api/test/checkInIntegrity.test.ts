import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(
  new URL('../../migrations/007_restore_historical_check_ins.sql', import.meta.url)
);
const migration = readFileSync(migrationPath, 'utf8');

test('check-in repair restores every deleted seed row without deleting history', () => {
  for (const id of [268, 315, 404, 605, 1127, 1251, 1692, 1741, 1743]) {
    assert.match(migration, new RegExp(`\\(${id},\\s`));
  }

  assert.doesNotMatch(migration, /delete\s+from\s+check_in/i);
});

test('only non-voided check-ins are unique attendance records', () => {
  assert.match(migration, /create unique index uq_check_in_enrolment/i);
  assert.match(migration, /where voided_at is null/i);
  assert.match(migration, /chk_check_in_void_metadata/i);
});
