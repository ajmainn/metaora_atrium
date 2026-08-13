import { PoolClient, QueryResultRow } from 'pg';
import { roomFee, seatFee } from './credits';
import { validateSessionSchedule } from './sessionCreation';
import {
  buildRoomReservations,
  ensureReservationRoomsAvailable,
  insertRoomReservations,
  loadReservationRooms,
  reservationCapacity,
  RoomReservationError,
  validateReservationRoomTypes
} from './sessionRoomReservations';

type RescheduleActor = { id: number; kind: 'coach' | 'admin' | 'participant' };

type RescheduleInput = {
  room_id?: number;
  second_teaching_room_id?: number | null;
  lunch_room_id?: number | null;
  intensive_split?: string | null;
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

type RoomRow = QueryResultRow & { id: number; name: string; capacity: number; room_type?: string };
type ExistingReservationRow = QueryResultRow & {
  room_id: number;
  reservation_type: string;
  starts_at: string | Date;
  ends_at: string | Date;
};
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

function minutesBetween(start: string | Date, end: string | Date): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / (60 * 1000));
}

function splitFromExistingReservations(reservations: ExistingReservationRow[]): string | undefined {
  const first = reservations.find((reservation) => reservation.reservation_type === 'teaching_block_1');
  const second = reservations.find((reservation) => reservation.reservation_type === 'teaching_block_2');
  if (!first || !second) return undefined;
  const split = `${minutesBetween(first.starts_at, first.ends_at)}-${minutesBetween(second.starts_at, second.ends_at)}`;
  return split === '90-90' || split === '60-120' || split === '120-60' ? split : undefined;
}

function rethrowRoomReservationError(error: unknown): never {
  if (error instanceof RoomReservationError) {
    throw new SessionRescheduleError(error.status, error.message);
  }
  throw error;
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

  const existingReservations = await client.query<ExistingReservationRow>(
    `select room_id, reservation_type, starts_at, ends_at
       from session_room_reservation
      where session_id = $1
      order by starts_at, id`,
    [sessionId]
  );
  const existingReservation = (type: string) =>
    existingReservations.rows.find((reservation) => reservation.reservation_type === type);

  const roomId = input.room_id === undefined ? Number(existing.room_id) : asInteger(input.room_id);
  const secondTeachingRoomId =
    input.second_teaching_room_id === undefined || input.second_teaching_room_id === null
      ? undefined
      : asInteger(input.second_teaching_room_id);
  const lunchRoomId =
    input.lunch_room_id === undefined || input.lunch_room_id === null
      ? undefined
      : asInteger(input.lunch_room_id);
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

  if (roomId === null || coachId === null || secondTeachingRoomId === null || lunchRoomId === null) {
    throw new SessionRescheduleError(400, 'room_id, coach_id, second_teaching_room_id and lunch_room_id must be valid ids');
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

  let reservations;
  try {
    reservations = buildRoomReservations({
      room_id: roomId,
      second_teaching_room_id:
        secondTeachingRoomId ??
        (String(existing.session_type) === 'intensive'
          ? Number(existingReservation('teaching_block_2')?.room_id ?? existing.room_id)
          : undefined),
      lunch_room_id:
        lunchRoomId ??
        (String(existing.session_type) === 'intensive'
          ? Number(existingReservation('lunch')?.room_id)
          : undefined),
      session_type: sessionType,
      startsAt,
      endsAt,
      intensive_split: input.intensive_split ?? splitFromExistingReservations(existingReservations.rows)
    });
  } catch (error) {
    rethrowRoomReservationError(error);
  }

  const newRoomFee = roomFee(sessionType);
  const newSeatFee = seatFee(sessionType);
  if (!Number.isInteger(newRoomFee) || !Number.isInteger(newSeatFee) || newRoomFee < 0 || newSeatFee < 0) {
    throw new SessionRescheduleError(400, 'session fees must be whole credits');
  }

  let roomsById: Map<number, RoomRow>;
  try {
    roomsById = (await loadReservationRooms(client, reservations)) as Map<number, RoomRow>;
    validateReservationRoomTypes(reservations, roomsById);
  } catch (error) {
    rethrowRoomReservationError(error);
  }
  const primaryRoom = roomsById.get(roomId);

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

  if (activeEnrolments.rows.length > reservationCapacity(reservations, roomsById)) {
    throw new SessionRescheduleError(409, 'room capacity is too small for the active enrolments');
  }

  try {
    await ensureReservationRoomsAvailable(client, reservations, roomsById, sessionId);
  } catch (error) {
    rethrowRoomReservationError(error);
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

  await client.query('delete from session_room_reservation where session_id = $1', [sessionId]);
  await insertRoomReservations(client, sessionId, reservations);

  return {
    session: {
      ...updated.rows[0],
      room_capacity: reservationCapacity(reservations, roomsById),
      room_name: primaryRoom?.name,
      room_reservations: reservations.map((reservation) => ({
        room_id: reservation.room_id,
        reservation_type: reservation.reservation_type,
        starts_at: reservation.startsAt.toISOString(),
        ends_at: reservation.endsAt.toISOString()
      }))
    },
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
