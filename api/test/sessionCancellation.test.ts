import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCoachCancellation } from '../src/sessionCancellation';

type QueryCall = {
  text: string;
  params: unknown[];
};

function fakeClient(calls: QueryCall[]) {
  return {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });

      if (text.includes('from enrolment')) {
        return {
          rows: [
            {
              id: 11,
              person_id: 101,
              credits_charged: '15',
              full_name: 'Participant One',
              email: 'one@atrium.local'
            },
            {
              id: 12,
              person_id: 102,
              credits_charged: '60',
              full_name: 'Coach Attendee',
              email: 'coach.attendee@atrium.local'
            }
          ],
          rowCount: 2
        };
      }

      if (text.includes('update enrolment')) {
        return { rows: [{ id: params[2] }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }
  };
}

const tiers = [
  { name: '96h or more', cancelledAt: '2026-11-01T15:00:00Z', percent: 1, roomRefund: 40 },
  { name: '48-96h', cancelledAt: '2026-11-02T15:00:00Z', percent: 0.5, roomRefund: 20 },
  { name: '24-48h', cancelledAt: '2026-11-04T09:00:00Z', percent: 0.25, roomRefund: 10 },
  { name: 'under 24h', cancelledAt: '2026-11-05T09:00:00Z', percent: 0, roomRefund: 0 },
  { name: 'after start', cancelledAt: '2026-11-09T15:00:00Z', percent: 0, roomRefund: 0 }
];

for (const tier of tiers) {
  test(`coach cancellation refunds room by policy and participants in full at ${tier.name}`, async () => {
    const calls: QueryCall[] = [];
    const summary = await applyCoachCancellation(
      fakeClient(calls) as any,
      {
        id: 7,
        coach_id: 201,
        room_fee_credits: '40',
        starts_at: '2026-11-05T15:00:00Z'
      },
      new Date(tier.cancelledAt)
    );

    assert.deepEqual(summary, {
      refundPercent: tier.percent,
      roomRefund: tier.roomRefund,
      enrolmentsCancelled: 2,
      seatsRefunded: 75,
      affectedParticipants: [
        {
          personId: 101,
          fullName: 'Participant One',
          email: 'one@atrium.local',
          refund: 15
        },
        {
          personId: 102,
          fullName: 'Coach Attendee',
          email: 'coach.attendee@atrium.local',
          refund: 60
        }
      ]
    });

    const enrolmentUpdates = calls.filter((call) => call.text.includes('update enrolment'));
    assert.deepEqual(
      enrolmentUpdates.map((call) => call.params),
      [
        [15, new Date(tier.cancelledAt).toISOString(), 11],
        [60, new Date(tier.cancelledAt).toISOString(), 12]
      ]
    );

    const balanceUpdates = calls.filter((call) => call.text.includes('update person set credits'));
    assert.deepEqual(
      balanceUpdates.map((call) => call.params),
      [
        [15, 101],
        [60, 102],
        [tier.roomRefund, 201]
      ]
    );

    assert.equal(calls.at(-1)?.text, "update session set status = 'cancelled' where id = $1");
    assert.deepEqual(calls.at(-1)?.params, [7]);
  });
}
