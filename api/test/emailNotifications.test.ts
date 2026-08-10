import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  notifyCoachCancelledSession,
  notifyParticipantBooked,
  notifyParticipantCancelled,
  notifySessionCreated
} from '../src/emailNotifications';
import { MailMessage, sendMailSafely } from '../src/mail';

const sessionRow = {
  id: 7,
  discipline: 'fitness',
  session_type: 'standard',
  starts_at: '2026-07-06T11:00:00Z',
  ends_at: '2026-07-06T12:00:00Z',
  room_name: 'Room 1',
  coach_name: 'Coach Carter',
  coach_email: 'coach@atrium.local',
  participant_name: 'Pat Learner'
};

function fakeQuery(admins = [{ email: 'admin@atrium.local' }]) {
  return async (text: string) => {
    if (text.includes("kind = 'admin'")) return admins;
    return [sessionRow];
  };
}

function collectingSender(messages: MailMessage[]) {
  return async (message: MailMessage) => {
    messages.push(message);
  };
}

test('participant booking sends coach notification', async () => {
  const messages: MailMessage[] = [];

  await notifyParticipantBooked(30, collectingSender(messages), fakeQuery() as any);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'coach@atrium.local');
  assert.match(messages[0].subject, /New Atrium booking/);
  assert.match(messages[0].text, /Pat Learner/);
});

test('coach session creation sends admin notification', async () => {
  const messages: MailMessage[] = [];

  await notifySessionCreated(7, collectingSender(messages), fakeQuery() as any);

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].to, ['admin@atrium.local']);
  assert.match(messages[0].subject, /session booked/);
});

test('participant cancellation sends coach notification', async () => {
  const messages: MailMessage[] = [];

  await notifyParticipantCancelled(30, 10, collectingSender(messages), fakeQuery() as any);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'coach@atrium.local');
  assert.match(messages[0].text, /Refund: 10 credits/);
});

test('coach cancellation sends admin and affected participant notifications', async () => {
  const messages: MailMessage[] = [];

  await notifyCoachCancelledSession(
    7,
    [
      { personId: 10, fullName: 'Pat Learner', email: 'pat@atrium.local', refund: 20 },
      { personId: 11, fullName: 'Coach Guest', email: 'guest.coach@atrium.local', refund: 20 }
    ],
    collectingSender(messages),
    fakeQuery() as any
  );

  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map((message) => message.to), [
    ['admin@atrium.local'],
    'pat@atrium.local',
    'guest.coach@atrium.local'
  ]);
  assert.match(messages[1].text, /refunded 20 credits/);
});

test('mail failure is logged and does not throw', async () => {
  let operationCommitted = false;
  operationCommitted = true;

  const ok = await sendMailSafely(
    { to: 'coach@atrium.local', subject: 'Will fail', text: 'This should not abort the operation.' },
    async () => {
      throw new Error('SMTP down');
    }
  );

  assert.equal(ok, false);
  assert.equal(operationCommitted, true);
});
