import { PoolClient, QueryResultRow } from 'pg';

type CheckInActor = {
  id: number;
  kind: 'admin' | 'coach' | 'participant';
};

type EnrolmentAttendance = QueryResultRow & {
  id: number;
  status: string;
  session_id: number;
  session_status: string;
  coach_id: number;
};

type ActiveCheckIn = QueryResultRow & {
  id: number;
  enrolment_id: number;
  checked_in_at: string | Date;
  voided_at: string | Date | null;
  void_reason: string | null;
};

export class CheckInError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function setEnrolmentCheckIn(
  client: Pick<PoolClient, 'query'>,
  sessionId: number,
  enrolmentId: number,
  actor: CheckInActor,
  checkedIn: boolean,
  checkedInAt: Date = new Date()
) {
  const enrolments = await client.query<EnrolmentAttendance>(
    `select e.id, e.status, e.session_id, s.status as session_status, s.coach_id
       from enrolment e
       join session s on s.id = e.session_id
      where e.id = $1 and e.session_id = $2
      for update of e, s`,
    [enrolmentId, sessionId]
  );

  if (enrolments.rows.length === 0) {
    throw new CheckInError(404, 'no such enrolment');
  }

  const enrolment = enrolments.rows[0];
  if (actor.kind !== 'admin' && !(actor.kind === 'coach' && enrolment.coach_id === actor.id)) {
    throw new CheckInError(403, 'forbidden');
  }

  if (enrolment.session_status === 'cancelled') {
    throw new CheckInError(409, 'cancelled sessions cannot have attendance changes');
  }

  if (enrolment.status !== 'active') {
    throw new CheckInError(409, 'only active enrolments can be checked in');
  }

  const existing = await client.query<ActiveCheckIn>(
    `select id, enrolment_id, checked_in_at, voided_at, void_reason
       from check_in
      where enrolment_id = $1 and voided_at is null
      for update`,
    [enrolmentId]
  );

  if (checkedIn) {
    if (existing.rows.length > 0) {
      return { checked_in: true, changed: false, check_in: existing.rows[0] };
    }

    const inserted = await client.query<ActiveCheckIn>(
      `insert into check_in (enrolment_id, checked_in_at)
       values ($1, $2)
       returning id, enrolment_id, checked_in_at, voided_at, void_reason`,
      [enrolmentId, checkedInAt.toISOString()]
    );

    return { checked_in: true, changed: true, check_in: inserted.rows[0] };
  }

  if (existing.rows.length === 0) {
    return { checked_in: false, changed: false, check_in: null };
  }

  const voided = await client.query<ActiveCheckIn>(
    `update check_in
        set voided_at = $1,
            void_reason = $2
      where id = $3 and voided_at is null
      returning id, enrolment_id, checked_in_at, voided_at, void_reason`,
    [
      checkedInAt.toISOString(),
      `attendance removed by ${actor.kind}`,
      existing.rows[0].id
    ]
  );

  return { checked_in: false, changed: true, check_in: voided.rows[0] || null };
}
