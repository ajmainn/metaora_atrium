import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionCreationError } from '../src/sessionCreation';
import { rescheduleSession, SessionRescheduleError } from '../src/sessionReschedule';

type Session = {
  id: number;
  room_id: number;
  coach_id: number;
  discipline: string;
  session_type: string;
  status: string;
  starts_at: string;
  ends_at: string;
  room_fee_credits: number;
  seat_fee_credits: number;
};

type Enrolment = {
  id: number;
  session_id: number;
  person_id: number;
  status: string;
  credits_charged: number;
};

type State = {
  session?: Session;
  rooms?: Array<{ id: number; name: string; capacity: number }>;
  coaches?: Array<{ id: number; credits: number; active?: boolean }>;
  enrolments?: Enrolment[];
  otherSessions?: Session[];
  otherEnrolments?: Array<{ id: number; person_id: number; session: Session }>;
  insufficientDebitPersonIds?: number[];
};

const NOW = new Date('2026-07-01T12:00:00Z');
const BASE_SESSION: Session = {
  id: 7,
  room_id: 1,
  coach_id: 20,
  discipline: 'fitness',
  session_type: 'standard',
  status: 'scheduled',
  starts_at: '2026-07-06T14:00:00Z',
  ends_at: '2026-07-06T15:00:00Z',
  room_fee_credits: 40,
  seat_fee_credits: 20
};

function overlaps(session: Session, start: string, end: string) {
  return new Date(session.starts_at) < new Date(end) && new Date(session.ends_at) > new Date(start);
}

function fakeClient(state: State = {}) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const session = { ...(state.session || BASE_SESSION) };
  const rooms = state.rooms || [
    { id: 1, name: 'Room 1', capacity: 8 },
    { id: 2, name: 'Room 2', capacity: 8 },
    { id: 3, name: 'Small Room', capacity: 1 }
  ];
  const coaches = state.coaches || [
    { id: 20, credits: 200 },
    { id: 21, credits: 200 }
  ];
  const enrolments =
    state.enrolments || [
      { id: 101, session_id: 7, person_id: 30, status: 'active', credits_charged: 20 },
      { id: 102, session_id: 7, person_id: 31, status: 'active', credits_charged: 20 }
    ];

  return {
    calls,
    session,
    enrolments,
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });

      if (text.startsWith('select * from session where id = $1')) {
        return session.id === params[0] ? { rows: [session], rowCount: 1 } : { rows: [], rowCount: 0 };
      }

      if (text.startsWith('select id, name, capacity from room')) {
        return { rows: rooms.filter((room) => room.id === params[0]), rowCount: 1 };
      }

      if (text.includes("kind = 'coach'")) {
        return {
          rows: coaches
            .filter((coach) => coach.id === params[0] && coach.active !== false)
            .map((coach) => ({ id: coach.id, credits: String(coach.credits) })),
          rowCount: 1
        };
      }

      if (text.includes('from enrolment where session_id = $1')) {
        return {
          rows: enrolments
            .filter((enrolment) => enrolment.session_id === params[0] && enrolment.status === 'active')
            .map((enrolment) => ({ ...enrolment, credits_charged: String(enrolment.credits_charged) })),
          rowCount: 1
        };
      }

      if (text.includes('from session') && text.includes('room_id = $2')) {
        return {
          rows: (state.otherSessions || []).filter(
            (other) => other.id !== params[0] && other.room_id === params[1] && other.status === 'scheduled' && overlaps(other, params[2] as string, params[3] as string)
          ),
          rowCount: 1
        };
      }

      if (text.includes('from session') && text.includes('coach_id = $2')) {
        return {
          rows: (state.otherSessions || []).filter(
            (other) => other.id !== params[0] && other.coach_id === params[1] && other.status === 'scheduled' && overlaps(other, params[2] as string, params[3] as string)
          ),
          rowCount: 1
        };
      }

      if (text.includes('from enrolment e')) {
        const personId = Number(params[0]);
        return {
          rows: (state.otherEnrolments || []).filter(
            (other) =>
              other.person_id === personId &&
              other.session.id !== params[1] &&
              other.session.status === 'scheduled' &&
              overlaps(other.session, params[2] as string, params[3] as string)
          ),
          rowCount: 1
        };
      }

      if (text.startsWith('update person set credits = credits - $1')) {
        if ((state.insufficientDebitPersonIds || []).includes(Number(params[1]))) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [{ credits: 100 }], rowCount: 1 };
      }

      if (text.startsWith('update person set credits = credits + $1')) {
        return { rows: [], rowCount: 1 };
      }

      if (text.startsWith('update enrolment set credits_charged')) {
        const enrolment = enrolments.find((item) => item.id === params[1]);
        if (enrolment) enrolment.credits_charged = Number(params[0]);
        return { rows: [], rowCount: 1 };
      }

      if (text.startsWith('update session')) {
        return {
          rows: [
            {
              ...session,
              room_id: Number(params[0]),
              coach_id: Number(params[1]),
              session_type: params[2] as string,
              starts_at: params[3] as string,
              ends_at: params[4] as string,
              room_fee_credits: Number(params[5]),
              seat_fee_credits: Number(params[6])
            }
          ],
          rowCount: 1
        };
      }

      return { rows: [], rowCount: 0 };
    }
  };
}

async function assertRejectsReschedule(state: State, input: Parameters<typeof rescheduleSession>[3], message: RegExp) {
  const client = fakeClient(state);
  await assert.rejects(
    () => rescheduleSession(client as any, 7, { id: 20, kind: 'coach' }, input, NOW),
    (error) => (error instanceof SessionRescheduleError || error instanceof SessionCreationError) && message.test(error.message)
  );
  assert.equal(client.calls.some((call) => call.text.startsWith('update session')), false);
}

test('successful time reschedule preserves active enrolments on the same session', async () => {
  const client = fakeClient();
  const result = await rescheduleSession(
    client as any,
    7,
    { id: 20, kind: 'coach' },
    { starts_at: '2026-07-07T14:00:00Z', ends_at: '2026-07-07T15:00:00Z' },
    NOW
  );

  assert.equal(result.session.id, 7);
  assert.deepEqual(result.activeEnrolmentIds, [101, 102]);
  assert.equal(client.enrolments.every((enrolment) => enrolment.session_id === 7), true);
  assert.equal(result.changed.time, true);
});

test('successful room change keeps the existing session record', async () => {
  const client = fakeClient();
  const result = await rescheduleSession(client as any, 7, { id: 20, kind: 'coach' }, { room_id: 2 }, NOW);

  assert.equal(result.session.id, 7);
  assert.equal(result.session.room_id, 2);
});

test('successful type change adjusts coach and participant fees transactionally', async () => {
  const client = fakeClient();
  const result = await rescheduleSession(
    client as any,
    7,
    { id: 20, kind: 'coach' },
    { session_type: 'intensive', ends_at: '2026-07-06T17:30:00Z' },
    NOW
  );

  assert.deepEqual(result.creditAdjustments, {
    oldRoomFee: 40,
    newRoomFee: 120,
    oldSeatFee: 20,
    newSeatFee: 60
  });
  assert.equal(client.enrolments.every((enrolment) => enrolment.credits_charged === 60), true);
  assert.equal(client.calls.some((call) => call.text.startsWith('update person set credits = credits - $1')), true);
});

test('administrator can reassign the coach with fee refund and recharge', async () => {
  const client = fakeClient();
  const result = await rescheduleSession(client as any, 7, { id: 1, kind: 'admin' }, { coach_id: 21 }, NOW);

  assert.equal(result.session.coach_id, 21);
  assert.deepEqual(
    client.calls
      .filter((call) => call.text.startsWith('update person set credits'))
      .map((call) => call.params),
    [
      [40, 20],
      [40, 21]
    ]
  );
});

test('administrator cannot reassign a session to an actively enrolled attendee', async () => {
  const client = fakeClient({
    coaches: [
      { id: 20, credits: 200 },
      { id: 31, credits: 200 }
    ]
  });

  await assert.rejects(
    () => rescheduleSession(client as any, 7, { id: 1, kind: 'admin' }, { coach_id: 31 }, NOW),
    (error) => error instanceof SessionRescheduleError && /own session/.test(error.message)
  );
  assert.equal(client.calls.some((call) => call.text.startsWith('update session')), false);
});

test('participant fee increase failure rejects before session update', async () => {
  await assertRejectsReschedule(
    { insufficientDebitPersonIds: [30] },
    { session_type: 'intensive', ends_at: '2026-07-06T17:30:00Z' },
    /insufficient credits/
  );
});

test('room conflict rejects the whole reschedule', async () => {
  await assertRejectsReschedule(
    {
      otherSessions: [{ ...BASE_SESSION, id: 99, room_id: 1, coach_id: 21, starts_at: '2026-07-07T14:30:00Z', ends_at: '2026-07-07T15:30:00Z' }]
    },
    { starts_at: '2026-07-07T14:00:00Z', ends_at: '2026-07-07T15:00:00Z' },
    /already booked/
  );
});

test('coach conflict rejects the whole reschedule', async () => {
  await assertRejectsReschedule(
    {
      otherSessions: [{ ...BASE_SESSION, id: 99, room_id: 2, coach_id: 20, starts_at: '2026-07-07T14:30:00Z', ends_at: '2026-07-07T15:30:00Z' }]
    },
    { starts_at: '2026-07-07T14:00:00Z', ends_at: '2026-07-07T15:00:00Z' },
    /already teaching/
  );
});

test('participant conflict rejects the whole reschedule', async () => {
  await assertRejectsReschedule(
    {
      otherEnrolments: [
        {
          id: 201,
          person_id: 30,
          session: { ...BASE_SESSION, id: 99, room_id: 2, coach_id: 21, starts_at: '2026-07-07T14:30:00Z', ends_at: '2026-07-07T15:30:00Z' }
        }
      ]
    },
    { starts_at: '2026-07-07T14:00:00Z', ends_at: '2026-07-07T15:00:00Z' },
    /participant has a conflicting/
  );
});

test('opening-hours and closed-day validation applies to reschedules', async () => {
  await assertRejectsReschedule({}, { starts_at: '2026-07-05T14:00:00Z', ends_at: '2026-07-05T15:00:00Z' }, /Monday to Saturday/);
  await assertRejectsReschedule({}, { starts_at: '2026-07-06T10:00:00Z', ends_at: '2026-07-06T11:00:00Z' }, /07:00-21:00/);
});

test('48-hour notice applies to reschedules', async () => {
  await assertRejectsReschedule(
    {},
    { starts_at: '2026-07-03T11:00:00Z', ends_at: '2026-07-03T12:00:00Z' },
    /48 hours/
  );
});

test('already-started scheduled sessions cannot be rescheduled', async () => {
  const client = fakeClient();
  await assert.rejects(
    () =>
      rescheduleSession(
        client as any,
        7,
        { id: 20, kind: 'coach' },
        { starts_at: '2026-07-08T14:00:00Z', ends_at: '2026-07-08T15:00:00Z' },
        new Date('2026-07-06T14:00:00Z')
      ),
    (error) => error instanceof SessionRescheduleError && /already started/.test(error.message)
  );
  assert.equal(client.calls.some((call) => call.text.startsWith('update session')), false);
});

test('invalid type without explicit end time is rejected cleanly', async () => {
  await assertRejectsReschedule({}, { session_type: 'marathon' }, /session_type/);
});

test('unauthorized coach cannot reschedule another coach session', async () => {
  const client = fakeClient();
  await assert.rejects(
    () => rescheduleSession(client as any, 7, { id: 21, kind: 'coach' }, { room_id: 2 }, NOW),
    (error) => error instanceof SessionRescheduleError && /another coach/.test(error.message)
  );
  assert.equal(client.calls.some((call) => call.text.startsWith('update session')), false);
});

test('cancelled sessions cannot be rescheduled', async () => {
  await assertRejectsReschedule({ session: { ...BASE_SESSION, status: 'cancelled' } }, { room_id: 2 }, /scheduled/);
});

test('capacity and coach self-enrolment checks reject before updates', async () => {
  await assertRejectsReschedule({ rooms: [{ id: 3, name: 'Tiny', capacity: 1 }] }, { room_id: 3 }, /capacity/);
  await assertRejectsReschedule({ enrolments: [{ id: 101, session_id: 7, person_id: 20, status: 'active', credits_charged: 20 }] }, { room_id: 2 }, /own session/);
});

test('intensive lunch occupancy is covered by full interval conflict checks', async () => {
  await assertRejectsReschedule(
    {
      otherEnrolments: [
        {
          id: 201,
          person_id: 30,
          session: { ...BASE_SESSION, id: 99, room_id: 2, coach_id: 21, starts_at: '2026-07-06T15:30:00Z', ends_at: '2026-07-06T16:00:00Z' }
        }
      ]
    },
    { session_type: 'intensive', ends_at: '2026-07-06T17:30:00Z' },
    /participant has a conflicting/
  );
});
