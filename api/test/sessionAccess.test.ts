import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireRole } from '../src/auth';
import { hasUnsafeSessionMutation, visibleSessionFields } from '../src/routes/sessions';

const session = {
  id: 7,
  room_id: 3,
  coach_id: 20,
  discipline: 'fitness',
  session_type: 'standard',
  status: 'scheduled',
  starts_at: '2026-11-05T15:00:00Z',
  ends_at: '2026-11-05T16:00:00Z',
  room_fee_credits: '40',
  seat_fee_credits: '20',
  created_at: '2026-10-01T12:00:00Z'
};
const room = { id: 3, name: 'Studio C', capacity: 16 };

test('other coaches see only an anonymous busy period', () => {
  const visible = visibleSessionFields({ id: 21, kind: 'coach' }, session, room);

  assert.deepEqual(visible, {
    id: 7,
    starts_at: session.starts_at,
    ends_at: session.ends_at,
    busy: true
  });
  assert.equal('coach_id' in visible, false);
  assert.equal('discipline' in visible, false);
  assert.equal('room_fee_credits' in visible, false);
});

test('participants do not receive coach identity or internal room fees', () => {
  const visible = visibleSessionFields({ id: 30, kind: 'participant' }, session, room);

  assert.equal(visible.discipline, 'fitness');
  assert.equal(visible.seat_fee_credits, '20');
  assert.equal('coach_id' in visible, false);
  assert.equal('room_fee_credits' in visible, false);
  assert.equal('created_at' in visible, false);
});

test('admins and owning coaches receive session management fields', () => {
  for (const viewer of [{ id: 1, kind: 'admin' as const }, { id: 20, kind: 'coach' as const }]) {
    const visible = visibleSessionFields(viewer, session, room);
    assert.equal(visible.coach_id, 20);
    assert.equal(visible.room_fee_credits, '40');
  }
});

test('session scheduling mutations are rejected from the generic update path', () => {
  for (const field of ['room_id', 'coach_id', 'session_type', 'status', 'starts_at', 'ends_at']) {
    assert.equal(hasUnsafeSessionMutation({ [field]: 'changed' }), true);
  }
  assert.equal(hasUnsafeSessionMutation({ discipline: 'career' }), false);
});

test('admin cannot pass participant and coach booking role checks', () => {
  const middleware = requireRole('participant', 'coach');
  let status = 0;
  let nextCalled = false;
  const response = {
    locals: { person: { id: 1, kind: 'admin' } },
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    }
  };

  middleware({} as any, response as any, () => { nextCalled = true; });
  assert.equal(status, 403);
  assert.equal(nextCalled, false);
});
