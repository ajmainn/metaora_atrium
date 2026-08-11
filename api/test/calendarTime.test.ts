import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centreLocalDateTimeToIso } from '../../web/app/calendarTime';

test('admin form times are interpreted explicitly in New York', () => {
  assert.equal(centreLocalDateTimeToIso('2026-01-15', '09:00'), '2026-01-15T14:00:00.000Z');
  assert.equal(centreLocalDateTimeToIso('2026-07-15', '09:00'), '2026-07-15T13:00:00.000Z');
});

test('nonexistent New York wall-clock times are rejected', () => {
  assert.throws(
    () => centreLocalDateTimeToIso('2026-03-08', '02:30'),
    /does not exist/
  );
});
