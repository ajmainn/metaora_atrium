import { PoolClient, QueryResultRow } from 'pg';

export type IntensiveSplit = '90-90' | '60-120' | '120-60';
export type ReservationType = 'teaching' | 'teaching_block_1' | 'lunch' | 'teaching_block_2';

export type RoomReservationInput = {
  room_id: number;
  second_teaching_room_id?: number | null;
  lunch_room_id?: number | null;
  session_type: string;
  startsAt: Date;
  endsAt: Date;
  intensive_split?: string | null;
};

export type BuiltRoomReservation = {
  room_id: number;
  reservation_type: ReservationType;
  startsAt: Date;
  endsAt: Date;
};

type RoomRow = QueryResultRow & {
  id: number;
  name: string;
  capacity: number;
  room_type?: string;
};

export class RoomReservationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function asSplit(value: string | null | undefined): IntensiveSplit {
  if (value === undefined || value === null || value === '') return '90-90';
  if (value === '90-90' || value === '60-120' || value === '120-60') return value;
  throw new RoomReservationError(400, 'intensive_split must be 90-90, 60-120 or 120-60');
}

export function buildRoomReservations(input: RoomReservationInput): BuiltRoomReservation[] {
  if (input.session_type !== 'intensive') {
    return [
      {
        room_id: input.room_id,
        reservation_type: 'teaching',
        startsAt: input.startsAt,
        endsAt: input.endsAt
      }
    ];
  }

  if (input.lunch_room_id === undefined || input.lunch_room_id === null) {
    throw new RoomReservationError(400, 'lunch_room_id is required for intensive sessions');
  }

  const split = asSplit(input.intensive_split);
  const [firstTeachingMinutes, secondTeachingMinutes] = split.split('-').map(Number);
  const lunchStartsAt = addMinutes(input.startsAt, firstTeachingMinutes);
  const lunchEndsAt = addMinutes(lunchStartsAt, 30);
  const secondRoomId = input.second_teaching_room_id ?? input.room_id;

  if (addMinutes(lunchEndsAt, secondTeachingMinutes).getTime() !== input.endsAt.getTime()) {
    throw new RoomReservationError(400, 'intensive split must match the 210-minute session duration');
  }

  return [
    {
      room_id: input.room_id,
      reservation_type: 'teaching_block_1',
      startsAt: input.startsAt,
      endsAt: lunchStartsAt
    },
    {
      room_id: input.lunch_room_id,
      reservation_type: 'lunch',
      startsAt: lunchStartsAt,
      endsAt: lunchEndsAt
    },
    {
      room_id: secondRoomId,
      reservation_type: 'teaching_block_2',
      startsAt: lunchEndsAt,
      endsAt: input.endsAt
    }
  ];
}

export async function loadReservationRooms(
  client: Pick<PoolClient, 'query'>,
  reservations: BuiltRoomReservation[]
): Promise<Map<number, RoomRow>> {
  const roomIds = [...new Set(reservations.map((reservation) => reservation.room_id))];
  const rooms = await client.query<RoomRow>(
    'select id, name, capacity, room_type from room where id = any($1::int[])',
    [roomIds]
  );
  const byId = new Map(rooms.rows.map((room) => [Number(room.id), room]));

  for (const id of roomIds) {
    if (!byId.has(id)) {
      throw new RoomReservationError(400, 'no such room');
    }
  }

  return byId;
}

export function validateReservationRoomTypes(
  reservations: BuiltRoomReservation[],
  roomsById: Map<number, RoomRow>
): void {
  for (const reservation of reservations) {
    const room = roomsById.get(reservation.room_id);
    const roomType = room?.room_type || 'teaching';

    if (reservation.reservation_type === 'lunch') {
      if (roomType !== 'lunch_dinner') {
        throw new RoomReservationError(400, 'lunch reservations must use a lunch/dinner room');
      }
      if (reservation.endsAt.getTime() - reservation.startsAt.getTime() !== 30 * 60 * 1000) {
        throw new RoomReservationError(400, 'lunch reservations must be exactly 30 minutes');
      }
    } else if (roomType !== 'teaching') {
      throw new RoomReservationError(400, 'teaching reservations must use teaching rooms');
    }
  }
}

export function reservationCapacity(
  reservations: BuiltRoomReservation[],
  roomsById: Map<number, RoomRow>
): number {
  return Math.min(...reservations.map((reservation) => Number(roomsById.get(reservation.room_id)?.capacity ?? 0)));
}

export async function ensureReservationRoomsAvailable(
  client: Pick<PoolClient, 'query'>,
  reservations: BuiltRoomReservation[],
  roomsById: Map<number, RoomRow>,
  excludingSessionId?: number
): Promise<void> {
  for (const reservation of reservations) {
    const params: unknown[] = [
      reservation.room_id,
      reservation.startsAt.toISOString(),
      reservation.endsAt.toISOString()
    ];
    let sessionFilter = '';

    if (excludingSessionId !== undefined) {
      params.push(excludingSessionId);
      sessionFilter = `and s.id <> $${params.length}`;
    }

    const clashes = await client.query(
      `select srr.id
         from session_room_reservation srr
         join session s on s.id = srr.session_id
        where srr.room_id = $1
          and s.status = 'scheduled'
          ${sessionFilter}
          and srr.starts_at < $3
          and srr.ends_at > $2
        limit 1`,
      params
    );

    if (clashes.rows.length > 0) {
      const room = roomsById.get(reservation.room_id);
      throw new RoomReservationError(409, `${room?.name || 'Room'} is already booked for that time`);
    }
  }
}

export async function insertRoomReservations(
  client: Pick<PoolClient, 'query'>,
  sessionId: number,
  reservations: BuiltRoomReservation[]
): Promise<void> {
  for (const reservation of reservations) {
    await client.query(
      `insert into session_room_reservation
         (session_id, room_id, reservation_type, starts_at, ends_at)
       values ($1, $2, $3, $4, $5)`,
      [
        sessionId,
        reservation.room_id,
        reservation.reservation_type,
        reservation.startsAt.toISOString(),
        reservation.endsAt.toISOString()
      ]
    );
  }
}
