import { PoolClient, QueryResultRow } from 'pg';
import { roomFee, seatFee } from './credits';

const CENTRE_TIME_ZONE = 'America/New_York';
const MIN_BOOKING_NOTICE_MS = 48 * 60 * 60 * 1000;
const SESSION_DURATIONS_MS: Record<string, number> = {
  short: 45 * 60 * 1000,
  standard: 60 * 60 * 1000,
  intensive: 210 * 60 * 1000
};

type CreateSessionInput = {
  room_id: number;
  coach_id: number;
  discipline: string;
  session_type: string;
  starts_at: string;
  ends_at: string;
};

type Room = QueryResultRow & {
  id: number;
  name: string;
  capacity: number;
};

type Coach = QueryResultRow & {
  id: number;
  credits: string;
};

export class SessionCreationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRE_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    weekday: value('weekday'),
    minutesAfterMidnight: Number(value('hour')) * 60 + Number(value('minute'))
  };
}

function assertValidInput(input: CreateSessionInput, now: Date): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(input.starts_at);
  const endsAt = new Date(input.ends_at);

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new SessionCreationError(400, 'starts_at and ends_at must be valid dates');
  }

  const expectedDuration = SESSION_DURATIONS_MS[input.session_type];
  if (!expectedDuration) {
    throw new SessionCreationError(400, 'session_type must be short, standard or intensive');
  }

  if (startsAt.getTime() - now.getTime() < MIN_BOOKING_NOTICE_MS) {
    throw new SessionCreationError(400, 'coach bookings must be made at least 48 hours before the session starts');
  }

  if (endsAt.getTime() - startsAt.getTime() !== expectedDuration) {
    throw new SessionCreationError(400, `${input.session_type} sessions must match the required duration`);
  }

  const startLocal = localParts(startsAt);
  const endLocal = localParts(endsAt);
  if (startLocal.weekday === 'Sun' || endLocal.weekday === 'Sun') {
    throw new SessionCreationError(400, 'sessions are allowed only Monday to Saturday');
  }

  if (startLocal.minutesAfterMidnight < 7 * 60 || endLocal.minutesAfterMidnight > 21 * 60) {
    throw new SessionCreationError(400, 'sessions must fit inside centre hours of 07:00-21:00 America/New_York');
  }

  return { startsAt, endsAt };
}

export async function createSessionBooking(
  client: Pick<PoolClient, 'query'>,
  input: CreateSessionInput,
  now: Date = new Date()
) {
  const { startsAt, endsAt } = assertValidInput(input, now);
  const fee = roomFee(input.session_type);
  const seat = seatFee(input.session_type);

  const rooms = await client.query<Room>('select id, name, capacity from room where id = $1', [
    input.room_id
  ]);
  if (rooms.rows.length === 0) {
    throw new SessionCreationError(400, 'no such room');
  }

  const coaches = await client.query<Coach>(
    "select id, credits from person where id = $1 and kind = 'coach' and active = true for update",
    [input.coach_id]
  );
  if (coaches.rows.length === 0) {
    throw new SessionCreationError(400, 'no such coach');
  }

  if (Number(coaches.rows[0].credits) < fee) {
    throw new SessionCreationError(409, 'coach has insufficient credits');
  }

  const roomClashes = await client.query(
    `select id, starts_at, ends_at
       from session
      where room_id = $1
        and status = 'scheduled'
        and starts_at < $3
        and ends_at > $2
      limit 1`,
    [input.room_id, startsAt.toISOString(), endsAt.toISOString()]
  );
  if (roomClashes.rows.length > 0) {
    throw new SessionCreationError(409, `${rooms.rows[0].name} is already booked for that time`);
  }

  const coachTeachingClashes = await client.query(
    `select id, starts_at, ends_at
       from session
      where coach_id = $1
        and status = 'scheduled'
        and starts_at < $3
        and ends_at > $2
      limit 1`,
    [input.coach_id, startsAt.toISOString(), endsAt.toISOString()]
  );
  if (coachTeachingClashes.rows.length > 0) {
    throw new SessionCreationError(409, 'coach is already teaching at that time');
  }

  const coachEnrolmentClashes = await client.query(
    `select e.id, s.starts_at, s.ends_at
       from enrolment e
       join session s on s.id = e.session_id
      where e.person_id = $1
        and e.status = 'active'
        and s.status = 'scheduled'
        and s.starts_at < $3
        and s.ends_at > $2
      limit 1`,
    [input.coach_id, startsAt.toISOString(), endsAt.toISOString()]
  );
  if (coachEnrolmentClashes.rows.length > 0) {
    throw new SessionCreationError(409, 'coach is already attending a session at that time');
  }

  const inserted = await client.query(
    `insert into session
       (room_id, coach_id, discipline, session_type, status, starts_at, ends_at,
        room_fee_credits, seat_fee_credits)
     values ($1, $2, $3, $4, 'scheduled', $5, $6, $7, $8)
     returning *`,
    [
      input.room_id,
      input.coach_id,
      input.discipline,
      input.session_type,
      startsAt.toISOString(),
      endsAt.toISOString(),
      fee,
      seat
    ]
  );

  const deduction = await client.query('update person set credits = credits - $1 where id = $2 and credits >= $1 returning credits', [
    fee,
    input.coach_id
  ]);
  if (deduction.rows.length === 0) {
    throw new SessionCreationError(409, 'coach has insufficient credits');
  }

  return inserted.rows[0];
}
