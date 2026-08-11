import { query } from './db';
import { MailSender, sendMailSafely } from './mail';
import type { QueryResultRow } from 'pg';

type SessionMailDetails = QueryResultRow & {
  id: number;
  discipline: string;
  session_type: string;
  starts_at: string | Date;
  ends_at: string | Date;
  room_name: string;
  coach_name: string;
  coach_email: string;
};

export type AffectedParticipant = {
  personId: number;
  fullName: string;
  email: string;
  refund: number;
};

export type RescheduledSessionSnapshot = {
  id: number;
  room_id: number;
  coach_id: number;
  discipline: string;
  session_type: string;
  starts_at: string | Date;
  ends_at: string | Date;
};

const centreTimeZone = process.env.CENTRE_TIMEZONE || 'America/New_York';
type QueryFn = <T extends QueryResultRow = any>(text: string, params?: unknown[]) => Promise<T[]>;

function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: centreTimeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function sessionLine(session: SessionMailDetails) {
  return `${session.discipline} (${session.session_type}) on ${formatDateTime(session.starts_at)}-${formatDateTime(session.ends_at)} in ${session.room_name}`;
}

async function adminEmails(queryFn: QueryFn) {
  const admins = await queryFn<{ email: string }>("select email from person where kind = 'admin' and active = true order by id");
  if (admins.length > 0) return uniqueEmails(admins.map((admin) => admin.email));
  return [process.env.SEED_ADMIN_EMAIL || 'admin@atrium.local'];
}

function uniqueEmails(emails: string[]) {
  const seen = new Set<string>();
  return emails.filter((email) => {
    const key = email.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function sendMailToNewRecipients(
  sent: Set<string>,
  message: Omit<Parameters<typeof sendMailSafely>[0], 'to'> & { to: string | string[] },
  sender?: MailSender
) {
  const recipients = uniqueEmails(Array.isArray(message.to) ? message.to : [message.to]).filter((email) => {
    const key = email.toLowerCase();
    if (sent.has(key)) return false;
    sent.add(key);
    return true;
  });

  if (recipients.length === 0) return false;
  return sendMailSafely(
    {
      ...message,
      to: Array.isArray(message.to) ? recipients : recipients[0]
    },
    sender
  );
}

async function sessionDetails(sessionId: number, queryFn: QueryFn) {
  const sessions = await queryFn<SessionMailDetails>(
    `select s.id, s.discipline, s.session_type, s.starts_at, s.ends_at,
            r.name as room_name, c.full_name as coach_name, c.email as coach_email
       from session s
       join room r on r.id = s.room_id
       join person c on c.id = s.coach_id
      where s.id = $1`,
    [sessionId]
  );
  return sessions[0] || null;
}

export async function notifySessionCreated(sessionId: number, sender?: MailSender, queryFn: QueryFn = query) {
  const session = await sessionDetails(sessionId, queryFn);
  if (!session) return;

  await sendMailSafely(
    {
      to: await adminEmails(queryFn),
      subject: `Atrium session booked: ${session.discipline}`,
      text: `${session.coach_name} booked ${sessionLine(session)}.`
    },
    sender
  );
}

export async function notifyParticipantBooked(enrolmentId: number, sender?: MailSender, queryFn: QueryFn = query) {
  const rows = await queryFn<SessionMailDetails & { participant_name: string }>(
    `select s.id, s.discipline, s.session_type, s.starts_at, s.ends_at,
            r.name as room_name, c.full_name as coach_name, c.email as coach_email,
            p.full_name as participant_name
       from enrolment e
       join session s on s.id = e.session_id
       join room r on r.id = s.room_id
       join person c on c.id = s.coach_id
       join person p on p.id = e.person_id
      where e.id = $1`,
    [enrolmentId]
  );

  const row = rows[0];
  if (!row) return;

  await sendMailSafely(
    {
      to: row.coach_email,
      subject: `New Atrium booking: ${row.discipline}`,
      text: `${row.participant_name} booked a place in ${sessionLine(row)}.`
    },
    sender
  );
}

export async function notifyParticipantCancelled(enrolmentId: number, refund: number, sender?: MailSender, queryFn: QueryFn = query) {
  const rows = await queryFn<SessionMailDetails & { participant_name: string }>(
    `select s.id, s.discipline, s.session_type, s.starts_at, s.ends_at,
            r.name as room_name, c.full_name as coach_name, c.email as coach_email,
            p.full_name as participant_name
       from enrolment e
       join session s on s.id = e.session_id
       join room r on r.id = s.room_id
       join person c on c.id = s.coach_id
       join person p on p.id = e.person_id
      where e.id = $1`,
    [enrolmentId]
  );

  const row = rows[0];
  if (!row) return;

  await sendMailSafely(
    {
      to: row.coach_email,
      subject: `Atrium booking cancelled: ${row.discipline}`,
      text: `${row.participant_name} cancelled their booking for ${sessionLine(row)}. Refund: ${refund} credits.`
    },
    sender
  );
}

export async function notifyCoachCancelledSession(
  sessionId: number,
  affectedParticipants: AffectedParticipant[],
  sender?: MailSender,
  queryFn: QueryFn = query
) {
  const session = await sessionDetails(sessionId, queryFn);
  if (!session) return;

  await sendMailSafely(
    {
      to: await adminEmails(queryFn),
      subject: `Atrium session cancelled: ${session.discipline}`,
      text: `${session.coach_name} cancelled ${sessionLine(session)}. Affected bookings: ${affectedParticipants.length}.`
    },
    sender
  );

  for (const participant of affectedParticipants) {
    await sendMailSafely(
      {
        to: participant.email,
        subject: `Atrium session cancelled: ${session.discipline}`,
        text: `${sessionLine(session)} was cancelled by the coach. You have been refunded ${participant.refund} credits.`
      },
      sender
    );
  }
}

export async function notifySessionRescheduled(
  sessionId: number,
  oldSession: RescheduledSessionSnapshot,
  newSession: RescheduledSessionSnapshot,
  activeEnrolmentIds: number[],
  sender?: MailSender,
  queryFn: QueryFn = query
) {
  const snapshotDetails = async (snapshot: RescheduledSessionSnapshot) =>
    queryFn<SessionMailDetails>(
    `select $1::int as id, $2::text as discipline, $3::text as session_type,
            $4::timestamptz as starts_at, $5::timestamptz as ends_at,
            r.name as room_name, c.full_name as coach_name, c.email as coach_email
       from room r
       join person c on c.id = $7
      where r.id = $6`,
    [
      snapshot.id,
      snapshot.discipline,
      snapshot.session_type,
      snapshot.starts_at,
      snapshot.ends_at,
      snapshot.room_id,
      snapshot.coach_id
    ]
  );

  const [previous, nextSession] = await Promise.all([
    snapshotDetails(oldSession).then((rows) => rows[0]),
    snapshotDetails(newSession).then((rows) => rows[0])
  ]);
  if (!previous || !nextSession) return;

  const changeText = `Old: ${sessionLine(previous)}.\nNew: ${sessionLine(nextSession)}.`;
  const sent = new Set<string>();

  await sendMailToNewRecipients(
    sent,
    {
      to: await adminEmails(queryFn),
      subject: `Atrium session rescheduled: ${nextSession.discipline}`,
      text: `${nextSession.coach_name} rescheduled a session.\n\n${changeText}`
    },
    sender
  );

  const coachRecipients = uniqueEmails([previous.coach_email, nextSession.coach_email]);
  for (const coachEmail of coachRecipients) {
    await sendMailToNewRecipients(
      sent,
      {
        to: coachEmail,
        subject: `Atrium session rescheduled: ${nextSession.discipline}`,
        text: `Your Atrium teaching session has changed.\n\n${changeText}`
      },
      sender
    );
  }

  if (activeEnrolmentIds.length === 0) return;

  const participants = await queryFn<{ email: string; full_name: string }>(
    `select distinct p.email, p.full_name
       from enrolment e
       join person p on p.id = e.person_id
      where e.id = any($1::int[])
      order by p.email`,
    [activeEnrolmentIds]
  );

  for (const participant of participants) {
    await sendMailToNewRecipients(
      sent,
      {
        to: participant.email,
        subject: `Atrium session rescheduled: ${nextSession.discipline}`,
        text: `${participant.full_name}, your Atrium session has changed.\n\n${changeText}`
      },
      sender
    );
  }
}
