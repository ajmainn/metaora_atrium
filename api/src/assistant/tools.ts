import { QueryResultRow } from 'pg';
import { AssistantCallerContext, AssistantQueryFn } from './context';

export type AssistantToolData = {
  role: AssistantCallerContext['role'];
  public_sessions: QueryResultRow[];
  profile?: {
    id: number;
    email: string;
    full_name: string;
    kind: 'participant' | 'coach' | 'admin';
    credits: string;
  };
  own_bookings?: QueryResultRow[];
  own_sessions?: QueryResultRow[];
  busy_periods?: QueryResultRow[];
  admin_sessions?: QueryResultRow[];
};

function defaultWindow(now: Date) {
  const from = now.toISOString();
  const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

export async function publicSessionCatalogue(
  queryFn: AssistantQueryFn,
  now: Date = new Date()
): Promise<QueryResultRow[]> {
  const { from, to } = defaultWindow(now);
  return queryFn(
    `select
            s.id,
            s.discipline,
            s.session_type,
            s.starts_at,
            s.ends_at,
            s.seat_fee_credits,
            r.name as room_name,
            r.capacity as room_capacity,
            count(e.id)::int as enrolled_count,
            (r.capacity - count(e.id))::int as places_remaining
       from session s
       join room r on r.id = s.room_id
       left join enrolment e on e.session_id = s.id and e.status = 'active'
      where s.starts_at >= $1
        and s.starts_at < $2
        and s.status = 'scheduled'
      group by s.id, r.id
      order by s.starts_at`,
    [from, to]
  );
}

export async function participantBookings(
  queryFn: AssistantQueryFn,
  personId: number
): Promise<QueryResultRow[]> {
  return queryFn(
    `select e.id as enrolment_id,
            e.status as enrolment_status,
            e.credits_charged,
            e.credits_refunded,
            e.enrolled_at,
            e.cancelled_at,
            s.id as session_id,
            s.discipline,
            s.session_type,
            s.status as session_status,
            s.starts_at,
            s.ends_at,
            s.seat_fee_credits,
            r.name as room_name
       from enrolment e
       join session s on s.id = e.session_id
       join room r on r.id = s.room_id
      where e.person_id = $1
      order by s.starts_at`,
    [personId]
  );
}

async function coachSessions(
  queryFn: AssistantQueryFn,
  coachId: number
): Promise<QueryResultRow[]> {
  const sessions = await queryFn(
    `select s.id,
            s.room_id,
            s.coach_id,
            s.discipline,
            s.session_type,
            s.status,
            s.starts_at,
            s.ends_at,
            s.room_fee_credits,
            s.seat_fee_credits,
            s.created_at,
            r.name as room_name,
            r.capacity as room_capacity,
            count(e.id)::int as enrolled_count
       from session s
       join room r on r.id = s.room_id
       left join enrolment e on e.session_id = s.id and e.status = 'active'
      where s.coach_id = $1
      group by s.id, r.id
      order by s.starts_at`,
    [coachId]
  );

  const ids = sessions.map((session) => Number(session.id)).filter(Number.isInteger);
  const attendees =
    ids.length === 0
      ? []
      : await queryFn(
          `select e.session_id,
                  e.id as enrolment_id,
                  e.status,
                  e.credits_charged,
                  e.credits_refunded,
                  e.enrolled_at,
                  e.cancelled_at,
                  p.id as person_id,
                  p.full_name,
                  p.email,
                  p.kind
             from enrolment e
             join person p on p.id = e.person_id
            where e.session_id = any($1::int[])
            order by e.session_id, p.full_name`,
          [ids]
        );

  return sessions.map((session) => ({
    ...session,
    attendees: attendees.filter((attendee) => attendee.session_id === session.id)
  }));
}

async function coachBusyPeriods(
  queryFn: AssistantQueryFn,
  coachId: number,
  now: Date = new Date()
): Promise<QueryResultRow[]> {
  const { from, to } = defaultWindow(now);
  return queryFn(
    `select s.starts_at, s.ends_at
       from session s
      where s.coach_id <> $1
        and s.status = 'scheduled'
        and s.starts_at >= $2
        and s.starts_at < $3
      order by s.starts_at`,
    [coachId, from, to]
  );
}

async function adminSessions(
  queryFn: AssistantQueryFn,
  now: Date = new Date()
): Promise<QueryResultRow[]> {
  const { from, to } = defaultWindow(now);
  const sessions = await queryFn(
    `select s.id,
            s.room_id,
            s.coach_id,
            s.discipline,
            s.session_type,
            s.status,
            s.starts_at,
            s.ends_at,
            s.room_fee_credits,
            s.seat_fee_credits,
            s.created_at,
            r.name as room_name,
            r.capacity as room_capacity,
            c.full_name as coach_name,
            c.email as coach_email,
            count(e.id)::int as enrolled_count,
            (r.capacity - count(e.id))::int as places_remaining
       from session s
       join room r on r.id = s.room_id
       join person c on c.id = s.coach_id
       left join enrolment e on e.session_id = s.id and e.status = 'active'
      where s.starts_at >= $1
        and s.starts_at < $2
      group by s.id, r.id, c.id
      order by s.starts_at`,
    [from, to]
  );

  const ids = sessions.map((session) => Number(session.id)).filter(Number.isInteger);
  const attendees =
    ids.length === 0
      ? []
      : await queryFn(
          `select e.session_id,
                  e.id as enrolment_id,
                  e.status,
                  e.credits_charged,
                  e.credits_refunded,
                  e.enrolled_at,
                  e.cancelled_at,
                  p.id as person_id,
                  p.full_name,
                  p.email,
                  p.kind
             from enrolment e
             join person p on p.id = e.person_id
            where e.session_id = any($1::int[])
            order by e.session_id, p.full_name`,
          [ids]
        );

  return sessions.map((session) => ({
    ...session,
    coach: {
      id: session.coach_id,
      full_name: session.coach_name,
      email: session.coach_email
    },
    attendees: attendees.filter((attendee) => attendee.session_id === session.id)
  }));
}

function profile(caller: AssistantCallerContext): AssistantToolData['profile'] {
  if (!caller.authenticated) return undefined;
  return {
    id: caller.person.id,
    email: caller.person.email,
    full_name: caller.person.full_name,
    kind: caller.person.kind,
    credits: caller.person.credits
  };
}

export async function buildAssistantToolData(
  caller: AssistantCallerContext,
  queryFn: AssistantQueryFn,
  now: Date = new Date()
): Promise<AssistantToolData> {
  const public_sessions = await publicSessionCatalogue(queryFn, now);
  const base: AssistantToolData = {
    role: caller.role,
    public_sessions,
    profile: profile(caller)
  };

  if (!caller.authenticated) {
    return { role: 'anonymous', public_sessions };
  }

  if (caller.role === 'participant') {
    return {
      ...base,
      own_bookings: await participantBookings(queryFn, caller.person.id)
    };
  }

  if (caller.role === 'coach') {
    return {
      ...base,
      own_sessions: await coachSessions(queryFn, caller.person.id),
      busy_periods: await coachBusyPeriods(queryFn, caller.person.id, now)
    };
  }

  return {
    ...base,
    admin_sessions: await adminSessions(queryFn, now)
  };
}
