import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrolInSession, SessionEnrolmentError } from '../src/sessionEnrolment';

type Session = {
  id: number;
  coach_id: number;
  status: string;
  starts_at: string;
  ends_at: string;
  seat_fee_credits: string;
  room_capacity: number;
};

type Commitment = {
  id: number;
  coach_id?: number;
  person_id?: number;
  status: string;
  starts_at: string;
  ends_at: string;
};

type FakeState = {
  session?: Session;
  personCredits?: number;
  personExists?: boolean;
  activeEnrolments?: number;
  duplicate?: boolean;
  teaching?: Commitment[];
  enrolments?: Commitment[];
};

function overlaps(commitment: Commitment, start: string, end: string) {
  return new Date(commitment.starts_at) < new Date(end) && new Date(commitment.ends_at) > new Date(start);
}

function fakeClient(state: FakeState = {}) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const session = state.session || {
    id: 7,
    coach_id: 20,
    status: 'scheduled',
    starts_at: '2026-07-06T11:00:00Z',
    ends_at: '2026-07-06T12:00:00Z',
    seat_fee_credits: '20',
    room_capacity: 2
  };
  const personCredits = state.personCredits ?? 100;

  return {
    calls,
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });

      if (text.includes('from session s') && text.includes('join room')) {
        return { rows: session.id === params[0] ? [session] : [], rowCount: 1 };
      }

      if (text.includes('from person')) {
        return state.personExists === false
          ? { rows: [], rowCount: 0 }
          : { rows: [{ id: params[0], credits: String(personCredits) }], rowCount: 1 };
      }

      if (text.includes('where session_id = $1 and person_id = $2')) {
        return { rows: state.duplicate ? [{ id: 3 }] : [], rowCount: state.duplicate ? 1 : 0 };
      }

      if (text.includes('count(*)::int as enrolled_count')) {
        return { rows: [{ enrolled_count: state.activeEnrolments ?? 0 }], rowCount: 1 };
      }

      if (text.includes('from session') && text.includes('coach_id = $1')) {
        const matches = (state.teaching || []).filter(
          (commitment) =>
            commitment.coach_id === params[0] &&
            commitment.status === 'scheduled' &&
            overlaps(commitment, params[1] as string, params[2] as string)
        );
        return { rows: matches, rowCount: matches.length };
      }

      if (text.includes('from enrolment e')) {
        const matches = (state.enrolments || []).filter(
          (commitment) =>
            commitment.person_id === params[0] &&
            commitment.status === 'active' &&
            overlaps(commitment, params[1] as string, params[2] as string)
        );
        return { rows: matches, rowCount: matches.length };
      }

      if (text.startsWith('update person set credits')) {
        return personCredits >= Number(params[0])
          ? { rows: [{ credits: personCredits - Number(params[0]) }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (text.startsWith('insert into enrolment')) {
        return {
          rows: [
            {
              id: 30,
              session_id: params[0],
              person_id: params[1],
              status: 'active',
              credits_charged: params[2],
              credits_refunded: 0,
              enrolled_at: '2026-07-01T12:00:00Z',
              cancelled_at: null
            }
          ],
          rowCount: 1
        };
      }

      return { rows: [], rowCount: 0 };
    }
  };
}

async function assertRejectsBooking(state: FakeState, message: RegExp, sessionId = 7, personId = 10) {
  await assert.rejects(
    () => enrolInSession(fakeClient(state) as any, sessionId, personId),
    (error) => error instanceof SessionEnrolmentError && message.test(error.message)
  );
}

test('successful participant booking deducts credits and creates active enrolment', async () => {
  const client = fakeClient();
  const enrolment = await enrolInSession(client as any, 7, 10);

  assert.equal(enrolment.id, 30);
  assert.equal(enrolment.status, 'active');
  assert.equal(enrolment.credits_charged, 20);
  assert.equal(enrolment.credits_refunded, 0);

  const deduction = client.calls.find((call) => call.text.startsWith('update person set credits'));
  assert.deepEqual(deduction?.params, [20, 10]);

  const insert = client.calls.find((call) => call.text.startsWith('insert into enrolment'));
  assert.deepEqual(insert?.params, [7, 10, 20]);
});

test('coach can attend another coach session as participant', async () => {
  const enrolment = await enrolInSession(fakeClient() as any, 7, 21);
  assert.equal(enrolment.person_id, 21);
});

test('coach cannot enrol in their own session', async () => {
  await assertRejectsBooking({}, /own session/, 7, 20);
});

test('duplicate active enrolment is rejected', async () => {
  await assertRejectsBooking({ duplicate: true }, /already booked/);
});

test('full-capacity session is rejected', async () => {
  await assertRejectsBooking({ activeEnrolments: 2 }, /full/);
});

test('teaching overlap is rejected', async () => {
  await assertRejectsBooking(
    {
      teaching: [
        {
          id: 1,
          coach_id: 10,
          status: 'scheduled',
          starts_at: '2026-07-06T11:30:00Z',
          ends_at: '2026-07-06T12:30:00Z'
        }
      ]
    },
    /already teaching/
  );
});

test('active participant-enrolment overlap is rejected', async () => {
  await assertRejectsBooking(
    {
      enrolments: [
        {
          id: 1,
          person_id: 10,
          status: 'active',
          starts_at: '2026-07-06T11:30:00Z',
          ends_at: '2026-07-06T12:30:00Z'
        }
      ]
    },
    /already booked/
  );
});

test('adjacent half-open commitment is allowed', async () => {
  const enrolment = await enrolInSession(
    fakeClient({
      enrolments: [
        {
          id: 1,
          person_id: 10,
          status: 'active',
          starts_at: '2026-07-06T10:00:00Z',
          ends_at: '2026-07-06T11:00:00Z'
        }
      ]
    }) as any,
    7,
    10
  );

  assert.equal(enrolment.id, 30);
});

test('insufficient credits are rejected', async () => {
  await assertRejectsBooking({ personCredits: 19 }, /insufficient credits/);
});

test('cancelled session is rejected', async () => {
  await assertRejectsBooking(
    {
      session: {
        id: 7,
        coach_id: 20,
        status: 'cancelled',
        starts_at: '2026-07-06T11:00:00Z',
        ends_at: '2026-07-06T12:00:00Z',
        seat_fee_credits: '20',
        room_capacity: 2
      }
    },
    /scheduled/
  );
});
