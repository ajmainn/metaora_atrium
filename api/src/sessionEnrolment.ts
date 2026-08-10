import { PoolClient, QueryResultRow } from 'pg';

type SessionForEnrolment = QueryResultRow & {
  id: number;
  coach_id: number;
  status: string;
  starts_at: string | Date;
  ends_at: string | Date;
  seat_fee_credits: string | number;
  room_capacity: number;
};

type PersonForEnrolment = QueryResultRow & {
  id: number;
  credits: string | number;
};

export class SessionEnrolmentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function enrolInSession(
  client: Pick<PoolClient, 'query'>,
  sessionId: number,
  personId: number
) {
  const sessions = await client.query<SessionForEnrolment>(
    `select s.id, s.coach_id, s.status, s.starts_at, s.ends_at, s.seat_fee_credits,
            r.capacity as room_capacity
       from session s
       join room r on r.id = s.room_id
      where s.id = $1
      for update of s`,
    [sessionId]
  );

  if (sessions.rows.length === 0) {
    throw new SessionEnrolmentError(404, 'no such session');
  }

  const session = sessions.rows[0];
  if (session.status !== 'scheduled') {
    throw new SessionEnrolmentError(409, 'only scheduled sessions can be booked');
  }

  if (session.coach_id === personId) {
    throw new SessionEnrolmentError(409, 'a coach cannot enrol in their own session');
  }

  const people = await client.query<PersonForEnrolment>(
    "select id, credits from person where id = $1 and kind in ('participant', 'coach') and active = true for update",
    [personId]
  );
  if (people.rows.length === 0) {
    throw new SessionEnrolmentError(403, 'only participants and coaches can book sessions');
  }

  const duplicate = await client.query(
    "select id from enrolment where session_id = $1 and person_id = $2 and status = 'active' limit 1",
    [sessionId, personId]
  );
  if (duplicate.rows.length > 0) {
    throw new SessionEnrolmentError(409, 'session is already booked by this person');
  }

  const activeCount = await client.query<{ enrolled_count: number } & QueryResultRow>(
    "select count(*)::int as enrolled_count from enrolment where session_id = $1 and status = 'active'",
    [sessionId]
  );
  if (Number(activeCount.rows[0].enrolled_count) >= Number(session.room_capacity)) {
    throw new SessionEnrolmentError(409, 'session is full');
  }

  const startsAt = new Date(session.starts_at).toISOString();
  const endsAt = new Date(session.ends_at).toISOString();

  const teachingClashes = await client.query(
    `select id
       from session
      where coach_id = $1
        and status = 'scheduled'
        and starts_at < $3
        and ends_at > $2
      limit 1`,
    [personId, startsAt, endsAt]
  );
  if (teachingClashes.rows.length > 0) {
    throw new SessionEnrolmentError(409, 'person is already teaching at that time');
  }

  const enrolmentClashes = await client.query(
    `select e.id
       from enrolment e
       join session s on s.id = e.session_id
      where e.person_id = $1
        and e.status = 'active'
        and s.status = 'scheduled'
        and s.starts_at < $3
        and s.ends_at > $2
      limit 1`,
    [personId, startsAt, endsAt]
  );
  if (enrolmentClashes.rows.length > 0) {
    throw new SessionEnrolmentError(409, 'person is already booked at that time');
  }

  const fee = Number(session.seat_fee_credits);
  if (Number(people.rows[0].credits) < fee) {
    throw new SessionEnrolmentError(409, 'insufficient credits');
  }

  const deduction = await client.query(
    'update person set credits = credits - $1 where id = $2 and credits >= $1 returning credits',
    [fee, personId]
  );
  if (deduction.rows.length === 0) {
    throw new SessionEnrolmentError(409, 'insufficient credits');
  }

  const inserted = await client.query(
    `insert into enrolment
       (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at)
     values ($1, $2, 'active', $3, 0, now())
     returning id, session_id, person_id, status, credits_charged, credits_refunded, enrolled_at, cancelled_at`,
    [sessionId, personId, fee]
  );

  return inserted.rows[0];
}
