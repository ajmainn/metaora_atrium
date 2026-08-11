import { PoolClient, QueryResultRow } from 'pg';
import { SessionCreationError } from '../sessionCreation';
import { applyCoachCancellation } from '../sessionCancellation';
import { rescheduleSession, SessionRescheduleError } from '../sessionReschedule';
import { withTransaction } from '../db';
import {
  notifyCoachCancelledSession,
  notifyParticipantBooked,
  notifyParticipantCancelled,
  notifySessionRescheduled
} from '../emailNotifications';
import {
  bookSessionAsAnonymousVisitor,
  isValidEmail,
  normalizeEmail,
  PasswordSetupError,
  sendPasswordSetupEmail
} from '../passwordSetup';
import { cancelOwnEnrolment, enrolInSession, SessionEnrolmentError } from '../sessionEnrolment';
import { AssistantCallerContext, AssistantQueryFn } from './context';
import { adminSessions, participantBookings, publicSessionCatalogue } from './tools';

export type AssistantToolName =
  | 'search_sessions'
  | 'get_my_bookings'
  | 'get_my_balance'
  | 'book_session'
  | 'cancel_booking'
  | 'anonymous_book_session'
  | 'get_my_sessions'
  | 'get_my_session_details'
  | 'get_my_session_attendance'
  | 'get_repeated_attendees'
  | 'cancel_my_session'
  | 'reschedule_my_session'
  | 'admin_list_sessions'
  | 'admin_get_session_details'
  | 'admin_list_people'
  | 'admin_cancel_session'
  | 'admin_reschedule_session';

export type AssistantToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type AssistantActionResult = {
  tool: AssistantToolName;
  ok: true;
  data: Record<string, unknown>;
};

export type AssistantTransactionFn = <T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: { isolationLevel?: 'serializable' }
) => Promise<T>;

export type AssistantActionDeps = {
  queryFn: AssistantQueryFn;
  withTransaction?: AssistantTransactionFn;
  notifyParticipantBooked?: (enrolmentId: number) => Promise<void>;
  notifyParticipantCancelled?: (enrolmentId: number, refundCredits: number) => Promise<void>;
  notifyCoachCancelledSession?: typeof notifyCoachCancelledSession;
  notifySessionRescheduled?: typeof notifySessionRescheduled;
  sendPasswordSetupEmail?: (email: string, rawToken: string) => Promise<boolean>;
  now?: Date;
};

export class AssistantActionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const assistantToolDescriptions = [
  {
    name: 'search_sessions',
    description: 'List public scheduled sessions with cost and remaining places.',
    roles: ['anonymous', 'participant', 'coach', 'admin']
  },
  {
    name: 'get_my_bookings',
    description: 'List the signed-in participant caller own bookings.',
    roles: ['participant']
  },
  {
    name: 'get_my_balance',
    description: 'Return the signed-in participant caller own credit balance.',
    roles: ['participant']
  },
  {
    name: 'book_session',
    description: 'Book the signed-in participant caller into one session by session_id.',
    roles: ['participant']
  },
  {
    name: 'cancel_booking',
    description: 'Cancel the signed-in participant caller own enrolment by session_id and enrolment_id.',
    roles: ['participant']
  },
  {
    name: 'anonymous_book_session',
    description: 'Book an anonymous visitor into one session by session_id and email.',
    roles: ['anonymous']
  },
  {
    name: 'get_my_sessions',
    description: 'List the signed-in coach caller own past and upcoming sessions.',
    roles: ['coach']
  },
  {
    name: 'get_my_session_details',
    description: 'Return attendee-level detail for one signed-in coach caller own session.',
    roles: ['coach']
  },
  {
    name: 'get_my_session_attendance',
    description: 'Return check-in and cancellation information for one signed-in coach caller own session.',
    roles: ['coach']
  },
  {
    name: 'get_repeated_attendees',
    description: 'Return deterministic repeated attendee counts across the signed-in coach caller own sessions.',
    roles: ['coach']
  },
  {
    name: 'cancel_my_session',
    description: 'Cancel one signed-in coach caller own session by explicit session_id.',
    roles: ['coach']
  },
  {
    name: 'reschedule_my_session',
    description: 'Reschedule one signed-in coach caller own session by explicit session_id and structured timing fields.',
    roles: ['coach']
  },
  {
    name: 'admin_list_sessions',
    description: 'List sessions with full admin-authorized details.',
    roles: ['admin']
  },
  {
    name: 'admin_get_session_details',
    description: 'Return full admin-authorized detail for any one session.',
    roles: ['admin']
  },
  {
    name: 'admin_list_people',
    description: 'List people and credit balances with admin authorization.',
    roles: ['admin']
  },
  {
    name: 'admin_cancel_session',
    description: 'Cancel any session by explicit session_id as administrator.',
    roles: ['admin']
  },
  {
    name: 'admin_reschedule_session',
    description: 'Reschedule any session with structured fields as administrator.',
    roles: ['admin']
  }
] as const;

function intArg(args: Record<string, unknown>, key: string): number {
  const value = typeof args[key] === 'string' ? Number(args[key]) : args[key];
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new AssistantActionError(400, `${key} must be a positive integer`);
  }
  return Number(value);
}

async function notifyAfterSuccess(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} notification failed`, err);
  }
}

function safeSessionRows(rows: QueryResultRow[]) {
  return rows.map((row) => ({
    id: row.id,
    discipline: row.discipline,
    session_type: row.session_type,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    seat_fee_credits: row.seat_fee_credits,
    room_name: row.room_name,
    room_capacity: row.room_capacity,
    places_remaining: row.places_remaining
  }));
}

function safeBookingRows(rows: QueryResultRow[]) {
  return rows.map((row) => ({
    enrolment_id: row.enrolment_id,
    enrolment_status: row.enrolment_status,
    credits_charged: row.credits_charged,
    credits_refunded: row.credits_refunded,
    enrolled_at: row.enrolled_at,
    cancelled_at: row.cancelled_at,
    session_id: row.session_id,
    discipline: row.discipline,
    session_type: row.session_type,
    session_status: row.session_status,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    seat_fee_credits: row.seat_fee_credits,
    room_name: row.room_name
  }));
}

function mapDomainError(err: unknown): never {
  if (
    err instanceof SessionEnrolmentError ||
    err instanceof PasswordSetupError ||
    err instanceof SessionRescheduleError ||
    err instanceof SessionCreationError
  ) {
    throw new AssistantActionError(err.status, err.message);
  }

  if ((err as { code?: string }).code === '23505') {
    throw new AssistantActionError(409, 'session is already booked by this person');
  }

  if ((err as { code?: string }).code === '40001') {
    throw new AssistantActionError(409, 'booking conflict, please retry');
  }

  throw err;
}

export function allowedAssistantToolNames(caller: AssistantCallerContext): AssistantToolName[] {
  if (!caller.authenticated) return ['search_sessions', 'anonymous_book_session'];
  if (caller.role === 'participant') {
    return ['search_sessions', 'get_my_bookings', 'get_my_balance', 'book_session', 'cancel_booking'];
  }
  if (caller.role === 'coach') {
    return [
      'search_sessions',
      'get_my_sessions',
      'get_my_session_details',
      'get_my_session_attendance',
      'get_repeated_attendees',
      'cancel_my_session',
      'reschedule_my_session'
    ];
  }
  return [
    'search_sessions',
    'admin_list_sessions',
    'admin_get_session_details',
    'admin_list_people',
    'admin_cancel_session',
    'admin_reschedule_session'
  ];
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new AssistantActionError(400, `${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalIntArg(args: Record<string, unknown>, key: string): number | undefined {
  if (args[key] === undefined) return undefined;
  return intArg(args, key);
}

function rescheduleInput(args: Record<string, unknown>, includeCoach: boolean) {
  return {
    room_id: optionalIntArg(args, 'room_id'),
    coach_id: includeCoach ? optionalIntArg(args, 'coach_id') : undefined,
    session_type: stringArg(args, 'session_type'),
    starts_at: stringArg(args, 'starts_at'),
    ends_at: stringArg(args, 'ends_at')
  };
}

function safeManagementSession(row: QueryResultRow) {
  return {
    id: row.id,
    room_id: row.room_id,
    coach_id: row.coach_id,
    discipline: row.discipline,
    session_type: row.session_type,
    status: row.status,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    room_fee_credits: row.room_fee_credits,
    seat_fee_credits: row.seat_fee_credits,
    room_name: row.room_name,
    room_capacity: row.room_capacity,
    enrolled_count: row.enrolled_count,
    places_remaining: row.places_remaining
  };
}

async function coachSessionsForAction(queryFn: AssistantQueryFn, coachId: number, now: Date) {
  const rows = await queryFn(
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
            r.name as room_name,
            r.capacity as room_capacity,
            count(e.id)::int as enrolled_count,
            (r.capacity - count(e.id))::int as places_remaining
       from session s
       join room r on r.id = s.room_id
       left join enrolment e on e.session_id = s.id and e.status = 'active'
      where s.coach_id = $1
      group by s.id, r.id
      order by s.starts_at`,
    [coachId]
  );

  return {
    upcoming: rows.filter((row) => new Date(row.starts_at as string | Date).getTime() >= now.getTime()).map(safeManagementSession),
    past: rows.filter((row) => new Date(row.starts_at as string | Date).getTime() < now.getTime()).map(safeManagementSession)
  };
}

async function coachSessionDetails(queryFn: AssistantQueryFn, coachId: number, sessionId: number) {
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
            r.name as room_name,
            r.capacity as room_capacity
       from session s
       join room r on r.id = s.room_id
      where s.id = $1 and s.coach_id = $2`,
    [sessionId, coachId]
  );
  if (sessions.length === 0) {
    throw new AssistantActionError(404, 'no such own session');
  }

  const attendees = await queryFn(
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
            p.kind,
            (ci.id is not null) as checked_in,
            ci.checked_in_at
       from enrolment e
       join person p on p.id = e.person_id
       left join check_in ci on ci.enrolment_id = e.id and ci.voided_at is null
      where e.session_id = $1
      order by p.full_name`,
    [sessionId]
  );

  return {
    session: safeManagementSession(sessions[0]),
    attendees
  };
}

async function repeatedAttendees(queryFn: AssistantQueryFn, coachId: number) {
  return queryFn(
    `select p.id as person_id,
            p.full_name,
            p.email,
            count(distinct e.session_id)::int as session_count,
            count(distinct ci.id)::int as attended_count,
            count(*) filter (where e.status = 'cancelled')::int as cancelled_count
       from enrolment e
       join session s on s.id = e.session_id
       join person p on p.id = e.person_id
       left join check_in ci on ci.enrolment_id = e.id and ci.voided_at is null
      where s.coach_id = $1
      group by p.id, p.full_name, p.email
     having count(distinct e.session_id) > 1
      order by session_count desc, p.full_name`,
    [coachId]
  );
}

async function adminSessionDetails(queryFn: AssistantQueryFn, sessionId: number) {
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
            r.name as room_name,
            r.capacity as room_capacity,
            c.full_name as coach_name,
            c.email as coach_email
       from session s
       join room r on r.id = s.room_id
       join person c on c.id = s.coach_id
      where s.id = $1`,
    [sessionId]
  );
  if (sessions.length === 0) {
    throw new AssistantActionError(404, 'no such session');
  }

  const attendees = await queryFn(
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
            p.kind,
            (ci.id is not null) as checked_in,
            ci.checked_in_at
       from enrolment e
       join person p on p.id = e.person_id
       left join check_in ci on ci.enrolment_id = e.id and ci.voided_at is null
      where e.session_id = $1
      order by p.full_name`,
    [sessionId]
  );

  return {
    session: {
      ...safeManagementSession(sessions[0]),
      coach: {
        id: sessions[0].coach_id,
        full_name: sessions[0].coach_name,
        email: sessions[0].coach_email
      }
    },
    attendees
  };
}

async function cancelManagedSession(
  caller: Extract<AssistantCallerContext, { authenticated: true }>,
  sessionId: number,
  deps: AssistantActionDeps
) {
  const tx = deps.withTransaction || withTransaction;
  const summary = await tx(async (client) => {
    const sessions = await client.query(
      'select * from session where id = $1 for update',
      [sessionId]
    );
    if (sessions.rows.length === 0) throw new AssistantActionError(404, 'no such session');

    const session = sessions.rows[0];
    if (caller.role === 'coach' && Number(session.coach_id) !== caller.person.id) {
      throw new AssistantActionError(403, 'cannot cancel another coach session');
    }
    if (caller.role !== 'coach' && caller.role !== 'admin') {
      throw new AssistantActionError(403, 'forbidden');
    }
    if (session.status === 'cancelled') {
      throw new AssistantActionError(409, 'that session is already cancelled');
    }

    return applyCoachCancellation(client, session, deps.now || new Date());
  }, { isolationLevel: 'serializable' });

  await notifyAfterSuccess('coach cancelled session', () =>
    (deps.notifyCoachCancelledSession || notifyCoachCancelledSession)(sessionId, summary.affectedParticipants)
  );

  return {
    id: sessionId,
    status: 'cancelled',
    refund_percent: summary.refundPercent,
    room_fee_refunded: summary.roomRefund,
    enrolments_cancelled: summary.enrolmentsCancelled,
    seat_fees_refunded: summary.seatsRefunded
  };
}

async function rescheduleManagedSession(
  caller: Extract<AssistantCallerContext, { authenticated: true }>,
  sessionId: number,
  args: Record<string, unknown>,
  deps: AssistantActionDeps
) {
  const tx = deps.withTransaction || withTransaction;
  const result = await tx(
    (client) =>
      rescheduleSession(
        client,
        sessionId,
        caller.person,
        rescheduleInput(args, caller.role === 'admin'),
        deps.now || new Date()
      ),
    { isolationLevel: 'serializable' }
  );

  await notifyAfterSuccess('session rescheduled', () =>
    (deps.notifySessionRescheduled || notifySessionRescheduled)(
      sessionId,
      result.oldSession,
      result.session,
      result.activeEnrolmentIds
    )
  );

  return {
    session: safeManagementSession(result.session),
    changed: result.changed,
    credit_adjustments: result.creditAdjustments,
    active_enrolment_ids: result.activeEnrolmentIds
  };
}

export async function executeAssistantAction(
  caller: AssistantCallerContext,
  call: AssistantToolCall,
  deps: AssistantActionDeps
): Promise<AssistantActionResult> {
  if (!call || typeof call.name !== 'string' || !call.name.trim()) {
    throw new AssistantActionError(400, 'assistant tool name is required');
  }

  if (
    call.arguments !== undefined &&
    (call.arguments === null || typeof call.arguments !== 'object' || Array.isArray(call.arguments))
  ) {
    throw new AssistantActionError(400, 'assistant tool arguments must be an object');
  }

  const name = call.name as AssistantToolName;
  const allowed = allowedAssistantToolNames(caller);
  if (!allowed.includes(name)) {
    throw new AssistantActionError(403, `assistant tool ${call.name} is not available to this caller`);
  }

  const args = call.arguments || {};
  const tx = deps.withTransaction || withTransaction;

  try {
    if (name === 'search_sessions') {
      const sessions = await publicSessionCatalogue(deps.queryFn, deps.now || new Date());
      return { tool: name, ok: true, data: { sessions: safeSessionRows(sessions) } };
    }

    if (!caller.authenticated) {
      throw new AssistantActionError(403, 'sign-in is required');
    }

    if (caller.role === 'coach') {
      if (name === 'get_my_sessions') {
        return {
          tool: name,
          ok: true,
          data: await coachSessionsForAction(deps.queryFn, caller.person.id, deps.now || new Date())
        };
      }

      if (name === 'get_my_session_details' || name === 'get_my_session_attendance') {
        const sessionId = intArg(args, 'session_id');
        return {
          tool: name,
          ok: true,
          data: await coachSessionDetails(deps.queryFn, caller.person.id, sessionId)
        };
      }

      if (name === 'get_repeated_attendees') {
        return {
          tool: name,
          ok: true,
          data: { attendees: await repeatedAttendees(deps.queryFn, caller.person.id) }
        };
      }

      if (name === 'cancel_my_session') {
        const sessionId = intArg(args, 'session_id');
        return {
          tool: name,
          ok: true,
          data: await cancelManagedSession(caller, sessionId, deps)
        };
      }

      if (name === 'reschedule_my_session') {
        const sessionId = intArg(args, 'session_id');
        return {
          tool: name,
          ok: true,
          data: await rescheduleManagedSession(caller, sessionId, args, deps)
        };
      }
    }

    if (caller.role === 'admin') {
      if (name === 'admin_list_sessions') {
        return {
          tool: name,
          ok: true,
          data: { sessions: await adminSessions(deps.queryFn, deps.now || new Date()) }
        };
      }

      if (name === 'admin_get_session_details') {
        const sessionId = intArg(args, 'session_id');
        return {
          tool: name,
          ok: true,
          data: await adminSessionDetails(deps.queryFn, sessionId)
        };
      }

      if (name === 'admin_list_people') {
        return {
          tool: name,
          ok: true,
          data: {
            people: await deps.queryFn(
              'select id, email, full_name, kind, credits, active from person order by full_name'
            )
          }
        };
      }

      if (name === 'admin_cancel_session') {
        const sessionId = intArg(args, 'session_id');
        return {
          tool: name,
          ok: true,
          data: await cancelManagedSession(caller, sessionId, deps)
        };
      }

      if (name === 'admin_reschedule_session') {
        const sessionId = intArg(args, 'session_id');
        return {
          tool: name,
          ok: true,
          data: await rescheduleManagedSession(caller, sessionId, args, deps)
        };
      }
    }

    if (!caller.authenticated || caller.role !== 'participant') {
      throw new AssistantActionError(403, 'participant sign-in is required');
    }

    if (name === 'get_my_balance') {
      return {
        tool: name,
        ok: true,
        data: {
          credits: caller.person.credits
        }
      };
    }

    if (name === 'get_my_bookings') {
      const bookings = await participantBookings(deps.queryFn, caller.person.id);
      return { tool: name, ok: true, data: { bookings: safeBookingRows(bookings) } };
    }

    if (name === 'book_session') {
      const sessionId = intArg(args, 'session_id');
      const enrolment = await tx(
        (client) => enrolInSession(client, sessionId, caller.person.id),
        { isolationLevel: 'serializable' }
      );

      await notifyAfterSuccess('participant booked', () =>
        (deps.notifyParticipantBooked || notifyParticipantBooked)(Number(enrolment.id))
      );

      return {
        tool: name,
        ok: true,
        data: {
          enrolment_id: enrolment.id,
          session_id: enrolment.session_id,
          status: enrolment.status,
          credits_charged: enrolment.credits_charged
        }
      };
    }

    if (name === 'cancel_booking') {
      const sessionId = intArg(args, 'session_id');
      const enrolmentId = intArg(args, 'enrolment_id');
      const enrolment = await tx(
        (client) => cancelOwnEnrolment(client, sessionId, enrolmentId, caller.person.id, deps.now || new Date()),
        { isolationLevel: 'serializable' }
      );

      await notifyAfterSuccess('participant cancelled', () =>
        (deps.notifyParticipantCancelled || notifyParticipantCancelled)(
          Number(enrolment.id),
          Number(enrolment.credits_refunded_now)
        )
      );

      return {
        tool: name,
        ok: true,
        data: {
          enrolment_id: enrolment.id,
          session_id: enrolment.session_id,
          status: enrolment.status,
          credits_refunded: enrolment.credits_refunded,
          credits_refunded_now: enrolment.credits_refunded_now,
          refund_percent: enrolment.refund_percent
        }
      };
    }

    if (name === 'anonymous_book_session') {
      throw new AssistantActionError(403, 'anonymous booking is available only before sign-in');
    }

    throw new AssistantActionError(403, `assistant tool ${call.name} is not available to this caller`);
  } catch (err) {
    mapDomainError(err);
  }
}

export async function executeAnonymousAssistantAction(
  caller: AssistantCallerContext,
  call: AssistantToolCall,
  deps: AssistantActionDeps
): Promise<AssistantActionResult> {
  const name = call.name as AssistantToolName;
  if (name !== 'anonymous_book_session') {
    return executeAssistantAction(caller, call, deps);
  }

  if (caller.authenticated) {
    throw new AssistantActionError(403, 'anonymous booking is available only before sign-in');
  }

  const args = call.arguments || {};
  const sessionId = intArg(args, 'session_id');
  const email = normalizeEmail(args.email);
  if (!isValidEmail(email)) {
    throw new AssistantActionError(400, 'a valid email address is required');
  }

  const tx = deps.withTransaction || withTransaction;
  try {
    const result = await tx(
      (client) => bookSessionAsAnonymousVisitor(client, sessionId, email),
      { isolationLevel: 'serializable' }
    );

    await notifyAfterSuccess('participant booked', () =>
      (deps.notifyParticipantBooked || notifyParticipantBooked)(Number(result.enrolment.id))
    );

    let passwordSetupEmailSent = false;
    if (result.setup) {
      passwordSetupEmailSent = await (deps.sendPasswordSetupEmail || sendPasswordSetupEmail)(
        result.email,
        result.setup.rawToken
      );
    }

    return {
      tool: name,
      ok: true,
      data: {
        enrolment_id: result.enrolment.id,
        session_id: result.enrolment.session_id,
        status: result.enrolment.status,
        credits_charged: result.enrolment.credits_charged,
        account_created: result.accountCreated,
        password_setup_email_sent: passwordSetupEmailSent
      }
    };
  } catch (err) {
    mapDomainError(err);
  }
}
