import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursOfNotice, refundAmount, refundPercent, roomFee, seatFee } from '../src/credits';

test('the fee schedule follows the session type', () => {
  assert.equal(roomFee('short'), 30);
  assert.equal(roomFee('standard'), 40);
  assert.equal(roomFee('intensive'), 120);
  assert.equal(seatFee('short'), 15);
  assert.equal(seatFee('standard'), 20);
  assert.equal(seatFee('intensive'), 60);
});

test('the refund percentage follows the notice given', () => {
  const start = new Date('2026-11-05T15:00:00Z');

  assert.equal(refundPercent(hoursOfNotice(new Date('2026-10-30T15:00:00Z'), start)), 1);
  assert.equal(refundPercent(hoursOfNotice(new Date('2026-11-01T15:00:00Z'), start)), 1);
  assert.equal(refundPercent(hoursOfNotice(new Date('2026-11-01T15:00:01Z'), start)), 0.5);
  assert.equal(refundPercent(hoursOfNotice(new Date('2026-11-03T15:00:00Z'), start)), 0.5);
  assert.equal(refundPercent(hoursOfNotice(new Date('2026-11-03T15:00:01Z'), start)), 0.25);
  assert.equal(refundPercent(hoursOfNotice(new Date('2026-11-04T15:00:00Z'), start)), 0.25);
  assert.equal(refundPercent(hoursOfNotice(new Date('2026-11-04T15:00:01Z'), start)), 0);
  assert.equal(refundPercent(hoursOfNotice(new Date('2026-11-02T15:00:00Z'), start)), 0.5);
  assert.equal(refundPercent(hoursOfNotice(new Date('2026-11-04T09:00:00Z'), start)), 0.25);
  assert.equal(refundPercent(hoursOfNotice(new Date('2026-11-05T09:00:00Z'), start)), 0);
});

test('a refund of part of a credit', () => {
  assert.equal(refundAmount(40, 0.5), 20);
  assert.equal(refundAmount(120, 0.25), 30);
  assert.equal(refundAmount(30, 0.25), 7);
});

test('cancellation after the session starts has negative notice and no refund', () => {
  const start = new Date('2026-11-05T15:00:00Z');
  const notice = hoursOfNotice(new Date('2026-11-09T15:00:00Z'), start);

  assert.equal(notice, -96);
  assert.equal(refundPercent(notice), 0);
});
