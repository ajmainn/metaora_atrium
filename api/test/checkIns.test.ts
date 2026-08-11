import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CheckInError, setEnrolmentCheckIn } from '../src/checkIns';

type Session = {
  id: number;
  coach_id: number;
  status: string;
};

type Enrolment = {
  id: number;
  session_id: number;
  status: string;
};

type CheckIn = {
  id: number;
  enrolment_id: number;
  checked_in_at: string;
  voided_at: string | null;
  void_reason: string | null;
};

function fakeClient(state: {
  session?: Session;
  enrolment?: Enrolment;
  checkIns?: CheckIn[];
} = {}) {
  const session = state.session || { id: 10, coach_id: 20, status: 'scheduled' };
  const enrolment = state.enrolment || { id: 30, session_id: 10, status: 'active' };
  const checkIns = state.checkIns || [];
  let nextCheckInId = 100;

  return {
    checkIns,
    async query(text: string, params: unknown[] = []) {
      if (text.includes('from enrolment e') && text.includes('join session s')) {
        if (enrolment.id !== params[0] || enrolment.session_id !== params[1]) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [{
            id: enrolment.id,
            status: enrolment.status,
            session_id: enrolment.session_id,
            session_status: session.status,
            coach_id: session.coach_id
          }],
          rowCount: 1
        };
      }

      if (text.includes('from check_in') && text.includes('voided_at is null')) {
        const rows = checkIns.filter((checkIn) => checkIn.enrolment_id === params[0] && !checkIn.voided_at);
        return { rows, rowCount: rows.length };
      }

      if (text.startsWith('insert into check_in')) {
        const checkIn = {
          id: nextCheckInId++,
          enrolment_id: Number(params[0]),
          checked_in_at: String(params[1]),
          voided_at: null,
          void_reason: null
        };
        checkIns.push(checkIn);
        return { rows: [checkIn], rowCount: 1 };
      }

      if (text.startsWith('update check_in')) {
        const checkIn = checkIns.find((row) => row.id === params[2] && !row.voided_at);
        if (!checkIn) return { rows: [], rowCount: 0 };
        checkIn.voided_at = String(params[0]);
        checkIn.void_reason = String(params[1]);
        return { rows: [checkIn], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }
  };
}

const now = new Date('2026-09-03T14:05:00Z');

test('owning coach can create one active check-in', async () => {
  const client = fakeClient();
  const result = await setEnrolmentCheckIn(
    client as any,
    10,
    30,
    { id: 20, kind: 'coach' },
    true,
    now
  );

  assert.equal(result.checked_in, true);
  assert.equal(result.changed, true);
  assert.equal(client.checkIns.length, 1);
  assert.equal(client.checkIns[0].checked_in_at, now.toISOString());

  const repeated = await setEnrolmentCheckIn(
    client as any,
    10,
    30,
    { id: 20, kind: 'coach' },
    true,
    now
  );

  assert.equal(repeated.checked_in, true);
  assert.equal(repeated.changed, false);
  assert.equal(client.checkIns.filter((checkIn) => !checkIn.voided_at).length, 1);
});

test('administrator can create attendance for any session', async () => {
  const client = fakeClient({ session: { id: 10, coach_id: 20, status: 'completed' } });
  const result = await setEnrolmentCheckIn(
    client as any,
    10,
    30,
    { id: 1, kind: 'admin' },
    true,
    now
  );

  assert.equal(result.checked_in, true);
  assert.equal(client.checkIns.length, 1);
});

test('other coaches and participants cannot manage check-ins', async () => {
  await assert.rejects(
    () =>
      setEnrolmentCheckIn(
        fakeClient() as any,
        10,
        30,
        { id: 99, kind: 'coach' },
        true,
        now
      ),
    (error) => error instanceof CheckInError && error.status === 403
  );

  await assert.rejects(
    () =>
      setEnrolmentCheckIn(
        fakeClient() as any,
        10,
        30,
        { id: 30, kind: 'participant' },
        true,
        now
      ),
    (error) => error instanceof CheckInError && error.status === 403
  );
});

test('cancelled sessions and enrolments reject attendance changes', async () => {
  await assert.rejects(
    () =>
      setEnrolmentCheckIn(
        fakeClient({ session: { id: 10, coach_id: 20, status: 'cancelled' } }) as any,
        10,
        30,
        { id: 20, kind: 'coach' },
        true,
        now
      ),
    (error) => error instanceof CheckInError && /cancelled sessions/.test(error.message)
  );

  await assert.rejects(
    () =>
      setEnrolmentCheckIn(
        fakeClient({ enrolment: { id: 30, session_id: 10, status: 'cancelled' } }) as any,
        10,
        30,
        { id: 20, kind: 'coach' },
        true,
        now
      ),
    (error) => error instanceof CheckInError && /active enrolments/.test(error.message)
  );
});

test('unchecking attendance voids the active check-in without deleting history', async () => {
  const client = fakeClient({
    checkIns: [{
      id: 88,
      enrolment_id: 30,
      checked_in_at: '2026-09-03T14:03:00Z',
      voided_at: null,
      void_reason: null
    }]
  });

  const result = await setEnrolmentCheckIn(
    client as any,
    10,
    30,
    { id: 20, kind: 'coach' },
    false,
    now
  );

  assert.equal(result.checked_in, false);
  assert.equal(result.changed, true);
  assert.equal(client.checkIns.length, 1);
  assert.equal(client.checkIns[0].voided_at, now.toISOString());
  assert.match(client.checkIns[0].void_reason || '', /attendance removed by coach/);
});
