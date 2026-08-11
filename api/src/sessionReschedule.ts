import { PoolClient, QueryResultRow } from 'pg';
import { roomFee, seatFee } from './credits';
import { validateSessionSchedule } from './sessionCreation';

type RescheduleActor = { id: number; kind: 'coach' | 'admin' | 'participant' };

type RescheduleInput = {
  room_id?: number;
  coach_id?: number;
  session_type?: string;
  starts_at?: string;
  ends_at?: string;
};

const SESSION_DURATIONS_MS: Record<string, number> = {
  short: 45 * 60 * 1000,
  standard: 60 * 60 * 1000,
  intensive: 210 * 60 * 1000
};

type SessionForReschedule = QueryResultRow & {
  id: number;
  room_id: number;
  coach_id: number;
  discipline: string;
  session_type: string;
  status: string;
  starts_at: string | Date;
  ends_at: string | Date;
  room_fee_credits: string | number;
  seat_fee_credits: string | number;
};

type RoomRow = QueryResultRow & { id: number; name: string; capacity: number };
type CoachRow = QueryResultRow & { id: number; credits: string | number };
type ActiveEnrolment = QueryResultRow & {
  id: number;
  person_id: number;
  credits_charged: string | number;
};

export class SessionRescheduleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function asInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function changed<T>(left: T, right: T): boolean {
  return String(left) !== String(right);
}

export async function rescheduleSession(
  client: Pick<PoolClient, 'query'>,
  sessionId: number,
  actor: RescheduleActor,
  input: RescheduleInput,
  now: Date = new Date()
) {
  const sessions = await client.query<SessionForReschedule>(
    'select * from session where id = $1 for update',
    [sessionId]
  );
  if (sessions.rows.length === 0) {
    throw new SessionRescheduleError(404, 'no such session');
  }

  const existing = sessions.rows[0];
  if (existing.status !== 'scheduled') {
    throw new SessionRescheduleError(409, 'only scheduled sessions can be rescheduled');
  }

  if (new Date(existing.starts_at).getTime() <= now.getTime()) {
    throw new SessionRescheduleError(409, 'sessions that have already started cannot be rescheduled');
  }

  if (actor.kind === 'coach' && existing.coach_id !== actor.id) {
    throw new SessionRescheduleError(403, 'cannot reschedule another coach session');
  }

  if (actor.kind !== 'coach' && actor.kind !== 'admin') {
    throw new SessionRescheduleError(403, 'forbidden');
  }

  const roomId = input.room_id === undefined ? Number(existing.room_id) : asInteger(input.room_id);
  const coachId =
    actor.kind === 'coach'
      ? actor.id
      : input.coach_id === undefined
        ? Number(existing.coach_id)
        : asInteger(input.coach_id);
  const sessionType =
    typeof input.session_type === 'string' && input.session_type.trim()
      ? input.session_type.trim().toLowerCase()
      : String(existing.session_type);
  const startsAtInput =
    typeof input.starts_at === 'string' && input.starts_at ? input.starts_at : new Date(existing.starts_at).toISOString();
  const durationChanged = sessionType !== String(existing.session_type);
  const endsAtInput =
    typeof input.ends_at === 'string' && input.ends_at
      ? input.ends_at
      : durationChanged
        ? (() => {
            const startsAtMs = new Date(startsAtInput).getTime();
            const duration = SESSION_DURATIONS_MS[sessionType];
            if (!duration) return new Date(existing.ends_at).toISOString();
            return Number.isFinite(startsAtMs) ? new Date(startsAtMs + duration).toISOString() : '';
          })()
        : new Date(existing.ends_at).toISOString();

  if (roomId === null || coachId === null) {
    throw new SessionRescheduleError(400, 'room_id and coach_id must be valid ids');
  }

  const { startsAt, endsAt } = validateSessionSchedule(
    {
      room_id: roomId,
      coach_id: coachId,
      discipline: existing.discipline,
      session_type: sessionType,
      starts_at: startsAtInput,
      ends_at: endsAtInput
    },
    now
  );

  const newRoomFee = roomFee(sessionType);
  const newSeatFee = seatFee(sessionType);
  if (!Number.isInteger(newRoomFee) || !Number.isInteger(newSeatFee) || newRoomFee < 0 || newSeatFee < 0) {
    throw new SessionRescheduleError(400, 'session fees must be whole credits');
  }

  const rooms = await client.query<RoomRow>('select id, name, capacity from room where id = $1', [roomId]);
  if (rooms.rows.length === 0) {
    throw new SessionRescheduleError(400, 'no such room');
  }

  const coaches = await client.query<CoachRow>(
    "select id, credits from person where id = $1 and kind = 'coach' and active = true for update",
    [coachId]
  );
  if (coaches.rows.length === 0) {
    throw new SessionRescheduleError(400, 'no such coach');
  }

  const activeEnrolments = await client.query<ActiveEnrolment>(
    "select id, person_id, credits_charged from enrolment where session_id = $1 and status = 'active' for update",
    [sessionId]
  );

  if (activeEnrolments.rows.some((enrolment) => Number(enrolment.person_id) === coachId)) {
    throw new SessionRescheduleError(409, 'a coach cannot enrol in their own session');
  }

  if (activeEnrolments.rows.length > Number(rooms.rows[0].capacity)) {
    throw new SessionRescheduleError(409, 'room capacity is too small for the active enrolments');
  }

  const roomClashes = await client.query(
    `select id
       from session
      where id <> $1
        and room_id = $2
        and status = 'scheduled'
        and starts_at < $4
        and ends_at > $3
      limit 1`,
    [sessionId, roomId, startsAt.toISOString(), endsAt.toISOString()]
  );
  if (roomClashes.rows.length > 0) {
    throw new SessionRescheduleError(409, `${rooms.rows[0].name} is already booked for that time`);
  }

  const coachTeachingClashes = await client.query(
    `select id
       from session
      where id <> $1
        and coach_id = $2
        and status = 'scheduled'
        and starts_at < $4
        and ends_at > $3
      limit 1`,
    [sessionId, coachId, startsAt.toISOString(), endsAt.toISOString()]
  );
  if (coachTeachingClashes.rows.length > 0) {
    throw new SessionRescheduleError(409, 'coach is already teaching at that time');
  }

  const coachEnrolmentClashes = await client.query(
    `select e.id
       from enrolment e
       join session s on s.id = e.session_id
      where e.person_id = $1
        and e.session_id <> $2
        and e.status = 'active'
        and s.status = 'scheduled'
        and s.starts_at < $4
        and s.ends_at > $3
      limit 1`,
    [coachId, sessionId, startsAt.toISOString(), endsAt.toISOString()]
  );
  if (coachEnrolmentClashes.rows.length > 0) {
    throw new SessionRescheduleError(409, 'coach is already attending a session at that time');
  }

  for (const enrolment of activeEnrolments.rows) {
    const participantClashes = await client.query(
      `select e.id
         from enrolment e
         join session s on s.id = e.session_id
        where e.person_id = $1
          and e.session_id <> $2
          and e.status = 'active'
          and s.status = 'scheduled'
          and s.starts_at < $4
          and s.ends_at > $3
        limit 1`,
      [enrolment.person_id, sessionId, startsAt.toISOString(), endsAt.toISOString()]
    );
    if (participantClashes.rows.length > 0) {
      throw new SessionRescheduleError(409, 'an active participant has a conflicting commitment');
    }
  }

  const oldRoomFee = Number(existing.room_fee_credits);
  const oldCoachId = Number(existing.coach_id);
  if (coachId !== oldCoachId) {
    await client.query('update person set credits = credits + $1 where id = $2', [oldRoomFee, oldCoachId]);
    const charged = await client.query(
      'update person set credits = credits - $1 where id = $2 and credits >= $1 returning credits',
      [newRoomFee, coachId]
    );
    if (charged.rows.length === 0) {
      throw new SessionRescheduleError(409, 'coach has insufficient credits');
    }
  } else {
    const roomDelta = newRoomFee - oldRoomFee;
    if (roomDelta > 0) {
      const charged = await client.query(
        'update person set credits = credits - $1 where id = $2 and credits >= $1 returning credits',
        [roomDelta, coachId]
      );
      if (charged.rows.length === 0) {
        throw new SessionRescheduleError(409, 'coach has insufficient credits');
      }
    } else if (roomDelta < 0) {
      await client.query('update person set credits = credits + $1 where id = $2', [-roomDelta, coachId]);
    }
  }

  for (const enrolment of activeEnrolments.rows) {
    const seatDelta = newSeatFee - Number(enrolment.credits_charged);
    if (seatDelta > 0) {
      const charged = await client.query(
        'update person set credits = credits - $1 where id = $2 and credits >= $1 returning credits',
        [seatDelta, enrolment.person_id]
      );
      if (charged.rows.length === 0) {
        throw new SessionRescheduleError(409, 'an active participant has insufficient credits for the new session type');
      }
    } else if (seatDelta < 0) {
      await client.query('update person set credits = credits + $1 where id = $2', [-seatDelta, enrolment.person_id]);
    }

    if (seatDelta !== 0) {
      await client.query('update enrolment set credits_charged = $1 where id = $2', [newSeatFee, enrolment.id]);
    }
  }

  const updated = await client.query(
    `update session
        set room_id = $1,
            coach_id = $2,
            session_type = $3,
            starts_at = $4,
            ends_at = $5,
            room_fee_credits = $6,
            seat_fee_credits = $7
      where id = $8 and status = 'scheduled'
      returning *`,
    [roomId, coachId, sessionType, startsAt.toISOString(), endsAt.toISOString(), newRoomFee, newSeatFee, sessionId]
  );
  if (updated.rows.length === 0) {
    throw new SessionRescheduleError(409, 'only scheduled sessions can be rescheduled');
  }

  return {
    session: updated.rows[0],
    oldSession: existing,
    activeEnrolmentIds: activeEnrolments.rows.map((enrolment) => Number(enrolment.id)),
    changed: {
      room: changed(existing.room_id, roomId),
      coach: changed(existing.coach_id, coachId),
      session_type: changed(existing.session_type, sessionType),
      time:
        new Date(existing.starts_at).toISOString() !== startsAt.toISOString() ||
        new Date(existing.ends_at).toISOString() !== endsAt.toISOString()
    },
    creditAdjustments: {
      oldRoomFee,
      newRoomFee,
      oldSeatFee: Number(existing.seat_fee_credits),
      newSeatFee
    }
  };
}
