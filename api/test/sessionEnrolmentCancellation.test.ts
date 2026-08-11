import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelOwnEnrolment,
  participantRefundPercent,
  SessionEnrolmentError
} from '../src/sessionEnrolment';
import { refundAmount } from '../src/credits';

type FakeState = {
  personId?: number;
  status?: string;
  sessionStatus?: string;
  creditsCharged?: string;
  startsAt?: string;
};

function fakeClient(state: FakeState = {}) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const personId = state.personId ?? 10;
  const status = state.status || 'active';
  const sessionStatus = state.sessionStatus || 'scheduled';
  const creditsCharged = state.creditsCharged || '20';
  const startsAt = state.startsAt || '2026-07-06T12:00:00Z';

  return {
    calls,
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });

      if (text.includes('from enrolment e') && text.includes('join session s')) {
        return {
          rows: [
            {
              id: params[0],
              session_id: params[1],
              person_id: personId,
              status,
              credits_charged: creditsCharged,
              credits_refunded: '0',
              enrolled_at: '2026-07-01T12:00:00Z',
              cancelled_at: null,
              session_status: sessionStatus,
              starts_at: startsAt
            }
          ],
          rowCount: 1
        };
      }

      if (text.startsWith('select id from person')) {
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }

      if (text.startsWith('update enrolment')) {
        return status === 'active'
          ? {
              rows: [
                {
                  id: params[1],
                  session_id: 7,
                  person_id: params[2],
                  status: 'cancelled',
                  credits_charged: creditsCharged,
                  credits_refunded: params[0],
                  enrolled_at: '2026-07-01T12:00:00Z',
                  cancelled_at: '2026-07-02T12:00:00Z'
                }
              ],
              rowCount: 1
            }
          : { rows: [], rowCount: 0 };
      }

      if (text.startsWith('update person set credits')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }
  };
}

async function cancelAt(cancelledAt: string, state: FakeState = {}, personId = 10) {
  const client = fakeClient(state);
  const result = await cancelOwnEnrolment(client as any, 7, 30, personId, new Date(cancelledAt));
  return { client, result };
}

test('participant refund policy returns the expected tiers', () => {
  assert.equal(participantRefundPercent(48), 1);
  assert.equal(participantRefundPercent(47.99), 0.5);
  assert.equal(participantRefundPercent(24), 0.5);
  assert.equal(participantRefundPercent(23.99), 0.25);
  assert.equal(participantRefundPercent(12), 0.25);
  assert.equal(participantRefundPercent(11.99), 0);
});

test('48h or more gives a full refund', async () => {
  const { result } = await cancelAt('2026-07-04T12:00:00Z');
  assert.equal(result.refund_percent, 1);
  assert.equal(result.credits_refunded_now, 20);
  assert.equal(result.credits_refunded, 20);
});

test('24-48h gives a 50 percent refund', async () => {
  const { result } = await cancelAt('2026-07-05T12:00:00Z');
  assert.equal(result.refund_percent, 0.5);
  assert.equal(result.credits_refunded_now, 10);
});

test('12-24h gives a 25 percent refund', async () => {
  const { result } = await cancelAt('2026-07-05T18:00:00Z');
  assert.equal(result.refund_percent, 0.25);
  assert.equal(result.credits_refunded_now, 5);
});

test('under 12h gives no refund', async () => {
  const { result } = await cancelAt('2026-07-06T01:00:00Z');
  assert.equal(result.refund_percent, 0);
  assert.equal(result.credits_refunded_now, 0);
});

test('cancellation after session start gives no refund', async () => {
  const { result } = await cancelAt('2026-07-10T12:00:00Z');
  assert.equal(result.refund_percent, 0);
  assert.equal(result.credits_refunded_now, 0);
});

test('integer rounding uses the existing refund helper', async () => {
  assert.equal(refundAmount(15, 0.5), 7);
  const { result } = await cancelAt('2026-07-05T12:00:00Z', { creditsCharged: '15' });
  assert.equal(result.credits_refunded_now, 7);
});

test('participant can cancel own enrolment and balance is updated', async () => {
  const { client, result } = await cancelAt('2026-07-04T12:00:00Z');

  assert.equal(result.person_id, 10);
  assert.equal(result.status, 'cancelled');

  const balanceUpdate = client.calls.find((call) => call.text.startsWith('update person set credits'));
  assert.deepEqual(balanceUpdate?.params, [20, 10]);
});

test('coach attending as participant can cancel own enrolment', async () => {
  const { result } = await cancelAt('2026-07-04T12:00:00Z', { personId: 22 }, 22);
  assert.equal(result.person_id, 22);
  assert.equal(result.status, 'cancelled');
});

test('cancelling another user enrolment is rejected', async () => {
  await assert.rejects(
    () => cancelOwnEnrolment(fakeClient({ personId: 11 }) as any, 7, 30, 10, new Date('2026-07-04T12:00:00Z')),
    (error) => error instanceof SessionEnrolmentError && /another person/.test(error.message)
  );
});

test('already-cancelled enrolment is rejected', async () => {
  await assert.rejects(
    () => cancelOwnEnrolment(fakeClient({ status: 'cancelled' }) as any, 7, 30, 10, new Date('2026-07-04T12:00:00Z')),
    (error) => error instanceof SessionEnrolmentError && /already cancelled/.test(error.message)
  );
});

test('session-cancelled enrolment cancellation is rejected', async () => {
  await assert.rejects(
    () =>
      cancelOwnEnrolment(
        fakeClient({ sessionStatus: 'cancelled' }) as any,
        7,
        30,
        10,
        new Date('2026-07-04T12:00:00Z')
      ),
    (error) => error instanceof SessionEnrolmentError && /already handled/.test(error.message)
  );
});

test('enrolment fields are updated without changing credits charged', async () => {
  const { client, result } = await cancelAt('2026-07-05T12:00:00Z');

  assert.equal(result.status, 'cancelled');
  assert.equal(result.credits_charged, '20');
  assert.equal(result.credits_refunded, 10);
  assert.ok(result.cancelled_at);

  const enrolmentUpdate = client.calls.find((call) => call.text.startsWith('update enrolment'));
  assert.deepEqual(enrolmentUpdate?.params, [10, 30, 10]);
});
