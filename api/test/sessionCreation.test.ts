import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionBooking, SessionCreationError } from '../src/sessionCreation';

type ExistingSession = {
  id: number;
  room_id: number;
  coach_id: number;
  status: string;
  starts_at: string;
  ends_at: string;
};

type ExistingEnrolment = {
  id: number;
  person_id: number;
  status: string;
  session: ExistingSession;
};

type FakeState = {
  rooms?: Array<{ id: number; name: string; capacity: number; room_type?: string }>;
  coachCredits?: number;
  sessions?: ExistingSession[];
  enrolments?: ExistingEnrolment[];
};

const NOW = new Date('2026-07-01T12:00:00Z');

function overlaps(existing: ExistingSession, start: string, end: string) {
  return new Date(existing.starts_at) < new Date(end) && new Date(existing.ends_at) > new Date(start);
}

function fakeClient(state: FakeState = {}) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const rooms = state.rooms || [
    { id: 1, name: 'Room 1', capacity: 8, room_type: 'teaching' },
    { id: 13, name: 'Lunch Room 1', capacity: 10, room_type: 'lunch_dinner' }
  ];
  const sessions = state.sessions || [];
  const enrolments = state.enrolments || [];
  const coachCredits = state.coachCredits ?? 200;

  return {
    calls,
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });

      if (text.startsWith('select id, name, capacity, room_type from room where id = any')) {
        return { rows: rooms.filter((room) => (params[0] as number[]).includes(room.id)), rowCount: 1 };
      }

      if (text.includes("kind = 'coach'")) {
        return { rows: [{ id: params[0], credits: String(coachCredits) }], rowCount: 1 };
      }

      if (text.includes('from session_room_reservation')) {
        return {
          rows: sessions.filter(
            (session) =>
              session.room_id === params[0] &&
              session.status === 'scheduled' &&
              overlaps(session, params[1] as string, params[2] as string)
          ),
          rowCount: 1
        };
      }

      if (text.includes('from session') && text.includes('coach_id = $1')) {
        return {
          rows: sessions.filter(
            (session) => session.coach_id === params[0] && session.status === 'scheduled' && overlaps(session, params[1] as string, params[2] as string)
          ),
          rowCount: 1
        };
      }

      if (text.includes('from enrolment')) {
        return {
          rows: enrolments.filter(
            (enrolment) =>
              enrolment.person_id === params[0] &&
              enrolment.status === 'active' &&
              enrolment.session.status === 'scheduled' &&
              overlaps(enrolment.session, params[1] as string, params[2] as string)
          ),
          rowCount: 1
        };
      }

      if (text.startsWith('insert into session')) {
        return { rows: [{ id: 99, room_id: params[0], coach_id: params[1] }], rowCount: 1 };
      }

      if (text.startsWith('insert into session_room_reservation')) {
        return { rows: [], rowCount: 1 };
      }

      if (text.startsWith('update person set credits')) {
        return coachCredits >= Number(params[0])
          ? { rows: [{ credits: coachCredits - Number(params[0]) }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    }
  };
}

async function assertRejectsBooking(input: Partial<Parameters<typeof createSessionBooking>[1]>, message: RegExp, state: FakeState = {}) {
  const client = fakeClient(state);
  await assert.rejects(
    () =>
      createSessionBooking(
        client as any,
        {
          room_id: 1,
          coach_id: 2,
          discipline: 'Math',
          session_type: 'short',
          starts_at: '2026-07-06T11:00:00Z',
          ends_at: '2026-07-06T11:45:00Z',
          ...input
        },
        NOW
      ),
    (error) => error instanceof SessionCreationError && message.test(error.message)
  );
}

test('valid booking inserts the session and deducts the room fee', async () => {
  const client = fakeClient();
  const created = await createSessionBooking(
    client as any,
    {
      room_id: 1,
      coach_id: 2,
      discipline: 'Math',
      session_type: 'standard',
      starts_at: '2026-07-06T11:00:00Z',
      ends_at: '2026-07-06T12:00:00Z'
    },
    NOW
  );

  assert.equal(created.id, 99);
  const insert = client.calls.find((call) => call.text.startsWith('insert into session'));
  assert.deepEqual(insert?.params.slice(6), [40, 20]);
  const deduction = client.calls.find((call) => call.text.startsWith('update person set credits'));
  assert.deepEqual(deduction?.params, [40, 2]);
});

test('booking less than 48 hours before start is rejected', async () => {
  await assertRejectsBooking(
    { starts_at: '2026-07-03T11:30:00Z', ends_at: '2026-07-03T12:15:00Z' },
    /48 hours/
  );
});

test('Sunday sessions are rejected', async () => {
  await assertRejectsBooking(
    { starts_at: '2026-07-05T11:00:00Z', ends_at: '2026-07-05T11:45:00Z' },
    /Monday to Saturday/
  );
});

test('sessions before 07:00 are rejected', async () => {
  await assertRejectsBooking(
    { starts_at: '2026-07-06T10:30:00Z', ends_at: '2026-07-06T11:15:00Z' },
    /07:00-21:00/
  );
});

test('sessions after 21:00 are rejected', async () => {
  await assertRejectsBooking(
    { starts_at: '2026-07-07T00:30:00Z', ends_at: '2026-07-07T01:15:00Z' },
    /07:00-21:00/
  );
});

test('sessions crossing a centre-local date boundary are rejected', async () => {
  await assertRejectsBooking(
    {
      session_type: 'intensive',
      starts_at: '2026-07-07T00:30:00Z',
      ends_at: '2026-07-07T04:00:00Z'
    },
    /07:00-21:00/
  );
});

test('half-open adjacent sessions are allowed', async () => {
  const client = fakeClient({
    sessions: [
      {
        id: 10,
        room_id: 1,
        coach_id: 3,
        status: 'scheduled',
        starts_at: '2026-07-06T10:00:00Z',
        ends_at: '2026-07-06T11:00:00Z'
      }
    ]
  });

  const created = await createSessionBooking(
    client as any,
    {
      room_id: 1,
      coach_id: 2,
      discipline: 'Math',
      session_type: 'short',
      starts_at: '2026-07-06T11:00:00Z',
      ends_at: '2026-07-06T11:45:00Z'
    },
    NOW
  );

  assert.equal(created.id, 99);
});

test('room overlap is rejected', async () => {
  await assertRejectsBooking(
    {},
    /already booked/,
    {
      sessions: [
        {
          id: 10,
          room_id: 1,
          coach_id: 3,
          status: 'scheduled',
          starts_at: '2026-07-06T11:30:00Z',
          ends_at: '2026-07-06T12:30:00Z'
        }
      ]
    }
  );
});

test('coach teaching overlap is rejected', async () => {
  await assertRejectsBooking(
    {},
    /already teaching/,
    {
      sessions: [
        {
          id: 10,
          room_id: 2,
          coach_id: 2,
          status: 'scheduled',
          starts_at: '2026-07-06T11:30:00Z',
          ends_at: '2026-07-06T12:30:00Z'
        }
      ]
    }
  );
});

test('coach active participant-enrolment overlap is rejected', async () => {
  await assertRejectsBooking(
    {},
    /already attending/,
    {
      enrolments: [
        {
          id: 20,
          person_id: 2,
          status: 'active',
          session: {
            id: 10,
            room_id: 2,
            coach_id: 3,
            status: 'scheduled',
            starts_at: '2026-07-06T11:30:00Z',
            ends_at: '2026-07-06T12:30:00Z'
          }
        }
      ]
    }
  );
});

test('insufficient coach credits are rejected', async () => {
  await assertRejectsBooking({}, /insufficient credits/, { coachCredits: 29 });
});

test('short, standard and intensive durations are enforced', async () => {
  const cases = [
    ['short', '2026-07-06T11:00:00Z', '2026-07-06T11:45:00Z'],
    ['standard', '2026-07-06T11:00:00Z', '2026-07-06T12:00:00Z'],
    ['intensive', '2026-07-06T11:00:00Z', '2026-07-06T14:30:00Z']
  ];

  for (const [session_type, starts_at, ends_at] of cases) {
    const created = await createSessionBooking(
      fakeClient() as any,
      { room_id: 1, lunch_room_id: session_type === 'intensive' ? 13 : undefined, coach_id: 2, discipline: 'Math', session_type, starts_at, ends_at },
      NOW
    );
    assert.equal(created.id, 99);
  }

  await assertRejectsBooking({ session_type: 'intensive', lunch_room_id: 13, ends_at: '2026-07-06T14:00:00Z' }, /required duration/);
});

test('intensive booking creates teaching, lunch and second teaching reservations', async () => {
  const client = fakeClient();
  const created = await createSessionBooking(
    client as any,
    {
      room_id: 1,
      second_teaching_room_id: 1,
      lunch_room_id: 13,
      intensive_split: '90-90',
      coach_id: 2,
      discipline: 'Math',
      session_type: 'intensive',
      starts_at: '2026-07-06T11:00:00Z',
      ends_at: '2026-07-06T14:30:00Z'
    },
    NOW
  );

  assert.equal(created.room_reservations.length, 3);
  assert.deepEqual(
    created.room_reservations.map((reservation: any) => reservation.reservation_type),
    ['teaching_block_1', 'lunch', 'teaching_block_2']
  );
});

test('teaching room is released during intensive lunch', async () => {
  const client = fakeClient({
    sessions: [
      {
        id: 10,
        room_id: 1,
        coach_id: 3,
        status: 'scheduled',
        starts_at: '2026-07-06T12:30:00Z',
        ends_at: '2026-07-06T13:00:00Z'
      }
    ]
  });

  const created = await createSessionBooking(
    client as any,
    {
      room_id: 1,
      lunch_room_id: 13,
      coach_id: 2,
      discipline: 'Math',
      session_type: 'intensive',
      starts_at: '2026-07-06T11:00:00Z',
      ends_at: '2026-07-06T14:30:00Z'
    },
    NOW
  );

  assert.equal(created.id, 99);
});

test('lunch rooms cannot be used for teaching and teaching rooms cannot be used for lunch', async () => {
  await assertRejectsBooking({ room_id: 13 }, /teaching reservations/);
  await assertRejectsBooking(
    { session_type: 'intensive', lunch_room_id: 1, ends_at: '2026-07-06T14:30:00Z' },
    /lunch reservations/
  );
});
