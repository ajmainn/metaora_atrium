import { PoolClient, QueryResultRow } from 'pg';
import { withTransaction } from '../db';
import { notifyParticipantBooked, notifyParticipantCancelled } from '../emailNotifications';
import {
  bookSessionAsAnonymousVisitor,
  isValidEmail,
  normalizeEmail,
  PasswordSetupError,
  sendPasswordSetupEmail
} from '../passwordSetup';
import { cancelOwnEnrolment, enrolInSession, SessionEnrolmentError } from '../sessionEnrolment';
import { AssistantCallerContext, AssistantQueryFn } from './context';
import { participantBookings, publicSessionCatalogue } from './tools';

export type AssistantToolName =
  | 'search_sessions'
  | 'get_my_bookings'
  | 'get_my_balance'
  | 'book_session'
  | 'cancel_booking'
  | 'anonymous_book_session';

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
  if (err instanceof SessionEnrolmentError || err instanceof PasswordSetupError) {
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
  return ['search_sessions'];
}

export async function executeAssistantAction(
  caller: AssistantCallerContext,
  call: AssistantToolCall,
  deps: AssistantActionDeps
): Promise<AssistantActionResult> {
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
