import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  centreDayWindow,
  sendAdminDailyDigest,
  sendCoachDailySummaries
} from '../src/scheduledEmails';
import { MailMessage } from '../src/mail';

function collectingSender(messages: MailMessage[]) {
  return async (message: MailMessage) => {
    messages.push(message);
  };
}

test('coach with bookings receives daily summary', async () => {
  const messages: MailMessage[] = [];
  const queryFn = async (text: string, params: unknown[] = []) => {
    if (text.includes("kind = 'coach'")) {
      return [{ id: 10, email: 'coach@atrium.local', full_name: 'Coach One' }];
    }
    if (text.includes('s.coach_id = $1')) {
      assert.equal(params[0], 10);
      return [
        {
          discipline: 'fitness',
          session_type: 'standard',
          starts_at: '2026-07-06T11:00:00Z',
          ends_at: '2026-07-06T12:00:00Z',
          room_name: 'Room 1',
          attendee_count: 2
        }
      ];
    }
    if (text.includes('from enrolment e')) return [];
    return [];
  };

  const result = await sendCoachDailySummaries(
    new Date('2026-07-06T04:00:00Z'),
    collectingSender(messages),
    queryFn as any
  );

  assert.equal(result.sent, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'coach@atrium.local');
  assert.match(messages[0].text, /Teaching:/);
  assert.match(messages[0].text, /attendees: 2/);
});

test('coach with no bookings receives no daily summary', async () => {
  const messages: MailMessage[] = [];
  const queryFn = async (text: string) => {
    if (text.includes("kind = 'coach'")) {
      return [{ id: 10, email: 'coach@atrium.local', full_name: 'Coach One' }];
    }
    return [];
  };

  const result = await sendCoachDailySummaries(
    new Date('2026-07-06T04:00:00Z'),
    collectingSender(messages),
    queryFn as any
  );

  assert.equal(result.sent, 0);
  assert.equal(messages.length, 0);
});

test('administrator receives daily digest', async () => {
  const messages: MailMessage[] = [];
  const queryFn = async (text: string) => {
    if (text.includes("kind = 'admin'")) return [{ email: 'admin@atrium.local' }];
    return [
      {
        discipline: 'nutrition',
        session_type: 'short',
        starts_at: '2026-07-06T13:00:00Z',
        ends_at: '2026-07-06T13:45:00Z',
        room_name: 'Room 2',
        coach_name: 'Coach Two',
        attendee_count: 3,
        checked_in_count: 1
      }
    ];
  };

  const result = await sendAdminDailyDigest(
    new Date('2026-07-06T04:00:00Z'),
    collectingSender(messages),
    queryFn as any
  );

  assert.equal(result.sent, 1);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].to, ['admin@atrium.local']);
  assert.match(messages[0].text, /active bookings: 3/);
  assert.match(messages[0].text, /checked in: 1/);
});

test('date window uses America/New_York calendar day across DST', () => {
  const window = centreDayWindow(new Date('2026-11-01T04:30:00Z'));

  assert.equal(window.dateKey, '2026-11-01');
  assert.equal(window.from.toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(window.to.toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal((window.to.getTime() - window.from.getTime()) / (60 * 1000), 25 * 60);
});
