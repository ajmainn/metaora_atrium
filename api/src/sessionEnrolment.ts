import { PoolClient, QueryResultRow } from 'pg';
import { hoursOfNotice, refundAmount } from './credits';

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

type EnrolmentForCancellation = QueryResultRow & {
  id: number;
  session_id: number;
  person_id: number;
  status: string;
  credits_charged: string | number;
  credits_refunded: string | number;
  enrolled_at: string | Date;
  cancelled_at: string | Date | null;
  session_status: string;
  starts_at: string | Date;
};

export class SessionEnrolmentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function participantRefundPercent(hoursNotice: number): number {
  if (hoursNotice >= 48) return 1;
  if (hoursNotice >= 24) return 0.5;
  if (hoursNotice >= 12) return 0.25;
  return 0;
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

export async function cancelOwnEnrolment(
  client: Pick<PoolClient, 'query'>,
  sessionId: number,
  enrolmentId: number,
  personId: number,
  cancelledAt: Date = new Date()
) {
  const enrolments = await client.query<EnrolmentForCancellation>(
    `select e.id, e.session_id, e.person_id, e.status, e.credits_charged, e.credits_refunded,
            e.enrolled_at, e.cancelled_at, s.status as session_status, s.starts_at
       from enrolment e
       join session s on s.id = e.session_id
      where e.id = $1 and e.session_id = $2
      for update of e`,
    [enrolmentId, sessionId]
  );

  if (enrolments.rows.length === 0) {
    throw new SessionEnrolmentError(404, 'no such enrolment');
  }

  const enrolment = enrolments.rows[0];
  if (enrolment.person_id !== personId) {
    throw new SessionEnrolmentError(403, 'cannot cancel another person enrolment');
  }

  if (enrolment.status === 'cancelled') {
    throw new SessionEnrolmentError(409, 'enrolment is already cancelled');
  }

  if (enrolment.session_status === 'cancelled') {
    throw new SessionEnrolmentError(409, 'session cancellation has already handled enrolment refunds');
  }

  const percent = participantRefundPercent(hoursOfNotice(cancelledAt, new Date(enrolment.starts_at)));
  const refund = refundAmount(Number(enrolment.credits_charged), percent);

  await client.query('select id from person where id = $1 for update', [personId]);

  const updated = await client.query(
    `update enrolment
        set status = 'cancelled', credits_refunded = $1, cancelled_at = now()
      where id = $2 and person_id = $3 and status = 'active'
      returning id, session_id, person_id, status, credits_charged, credits_refunded, enrolled_at, cancelled_at`,
    [refund, enrolmentId, personId]
  );

  if (updated.rows.length === 0) {
    throw new SessionEnrolmentError(409, 'enrolment is already cancelled');
  }

  await client.query('update person set credits = credits + $1 where id = $2', [refund, personId]);

  return {
    ...updated.rows[0],
    refund_percent: percent,
    credits_refunded_now: refund
  };
}
