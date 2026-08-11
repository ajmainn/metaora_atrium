import cron from 'node-cron';
import type { QueryResultRow } from 'pg';
import { query } from './db';
import { MailSender, sendMailSafely } from './mail';

const CENTRE_TIME_ZONE = process.env.CENTRE_TIMEZONE || 'America/New_York';
const DAY_MINUTES = 24 * 60;

type QueryFn = <T extends QueryResultRow = any>(text: string, params?: unknown[]) => Promise<T[]>;

type Coach = QueryResultRow & {
  id: number;
  email: string;
  full_name: string;
};

type CoachOwnSession = QueryResultRow & {
  discipline: string;
  session_type: string;
  starts_at: string | Date;
  ends_at: string | Date;
  room_name: string;
  attendee_count: number;
};

type CoachAttendingSession = QueryResultRow & {
  discipline: string;
  session_type: string;
  starts_at: string | Date;
  ends_at: string | Date;
  room_name: string;
  coach_name: string;
};

type AdminDigestRow = QueryResultRow & {
  discipline: string;
  session_type: string;
  starts_at: string | Date;
  ends_at: string | Date;
  room_name: string;
  coach_name: string;
  attendee_count: number;
  checked_in_count: number;
};

let schedulerStarted = false;

function partsInCentre(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(value);

  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute'))
  };
}

function localDateKey(value: Date) {
  const parts = partsInCentre(value);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addDaysToKey(key: string, days: number) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

function centreLocalTimeToUtc(key: string, hour: number, minute: number) {
  const [year, month, day] = key.split('-').map(Number);
  let guess = Date.UTC(year, month - 1, day, hour + 5, minute);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const seen = partsInCentre(new Date(guess));
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    const diffMinutes = (targetUtc - seenUtc) / (60 * 1000);
    if (diffMinutes === 0) break;
    guess += diffMinutes * 60 * 1000;
  }

  return new Date(guess);
}

export function centreDayWindow(runAt: Date = new Date()) {
  const dateKey = localDateKey(runAt);
  const nextDateKey = addDaysToKey(dateKey, 1);
  return {
    dateKey,
    from: centreLocalTimeToUtc(dateKey, 0, 0),
    to: centreLocalTimeToUtc(nextDateKey, 0, 0)
  };
}

function formatTime(value: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRE_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatDate(key: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(new Date(`${key}T12:00:00Z`));
}

function sessionLine(session: {
  discipline: string;
  session_type: string;
  starts_at: string | Date;
  ends_at: string | Date;
  room_name: string;
}) {
  return `${formatTime(session.starts_at)}-${formatTime(session.ends_at)} ${session.discipline} (${session.session_type}) in ${session.room_name}`;
}

async function adminEmails(queryFn: QueryFn) {
  const admins = await queryFn<{ email: string }>("select email from person where kind = 'admin' and active = true order by id");
  if (admins.length > 0) return admins.map((admin) => admin.email);
  return [process.env.SEED_ADMIN_EMAIL || 'admin@atrium.local'];
}

export async function sendCoachDailySummaries(
  runAt: Date = new Date(),
  sender?: MailSender,
  queryFn: QueryFn = query
) {
  const window = centreDayWindow(runAt);
  const coaches = await queryFn<Coach>(
    "select id, email, full_name from person where kind = 'coach' and active = true order by full_name"
  );
  let sent = 0;

  for (const coach of coaches) {
    const ownSessions = await queryFn<CoachOwnSession>(
      `select s.discipline, s.session_type, s.starts_at, s.ends_at, r.name as room_name,
              count(e.id)::int as attendee_count
         from session s
         join room r on r.id = s.room_id
         left join enrolment e on e.session_id = s.id and e.status = 'active'
        where s.coach_id = $1
          and s.status = 'scheduled'
          and s.starts_at >= $2
          and s.starts_at < $3
        group by s.id, r.id
        order by s.starts_at`,
      [coach.id, window.from.toISOString(), window.to.toISOString()]
    );

    const attending = await queryFn<CoachAttendingSession>(
      `select s.discipline, s.session_type, s.starts_at, s.ends_at,
              r.name as room_name, c.full_name as coach_name
         from enrolment e
         join session s on s.id = e.session_id
         join room r on r.id = s.room_id
         join person c on c.id = s.coach_id
        where e.person_id = $1
          and e.status = 'active'
          and s.status = 'scheduled'
          and s.starts_at >= $2
          and s.starts_at < $3
        order by s.starts_at`,
      [coach.id, window.from.toISOString(), window.to.toISOString()]
    );

    if (ownSessions.length === 0 && attending.length === 0) continue;

    const lines = [
      `Atrium summary for ${formatDate(window.dateKey)}`,
      '',
      'Teaching:',
      ...(ownSessions.length === 0
        ? ['- None']
        : ownSessions.map((session) => `- ${sessionLine(session)}; attendees: ${session.attendee_count}`)),
      '',
      'Attending:',
      ...(attending.length === 0
        ? ['- None']
        : attending.map((session) => `- ${sessionLine(session)}; coach: ${session.coach_name}`))
    ];

    const ok = await sendMailSafely(
      {
        to: coach.email,
        subject: `Atrium daily summary - ${formatDate(window.dateKey)}`,
        text: lines.join('\n')
      },
      sender
    );
    if (ok) sent += 1;
  }

  return { sent, dateKey: window.dateKey, from: window.from, to: window.to };
}

export async function sendAdminDailyDigest(
  runAt: Date = new Date(),
  sender?: MailSender,
  queryFn: QueryFn = query
) {
  const window = centreDayWindow(runAt);
  const sessions = await queryFn<AdminDigestRow>(
    `select s.discipline, s.session_type, s.starts_at, s.ends_at, r.name as room_name,
            c.full_name as coach_name,
            count(distinct e.id)::int as attendee_count,
            count(distinct ci.id)::int as checked_in_count
       from session s
       join room r on r.id = s.room_id
       join person c on c.id = s.coach_id
       left join enrolment e on e.session_id = s.id and e.status = 'active'
       left join check_in ci on ci.enrolment_id = e.id and ci.voided_at is null
      where s.status = 'scheduled'
        and s.starts_at >= $1
        and s.starts_at < $2
      group by s.id, r.id, c.id
      order by s.starts_at`,
    [window.from.toISOString(), window.to.toISOString()]
  );

  const lines = [
    `Atrium administrator digest for ${formatDate(window.dateKey)}`,
    '',
    ...(sessions.length === 0
      ? ['No scheduled sessions.']
      : sessions.map(
          (session) =>
            `- ${sessionLine(session)}; coach: ${session.coach_name}; active bookings: ${session.attendee_count}; checked in: ${session.checked_in_count}`
        ))
  ];

  const ok = await sendMailSafely(
    {
      to: await adminEmails(queryFn),
      subject: `Atrium daily digest - ${formatDate(window.dateKey)}`,
      text: lines.join('\n')
    },
    sender
  );

  return { sent: ok ? 1 : 0, dateKey: window.dateKey, from: window.from, to: window.to };
}

export async function runDailyEmailJobs(runAt: Date = new Date()) {
  await sendCoachDailySummaries(runAt);
  await sendAdminDailyDigest(runAt);
}

export function startDailyEmailScheduler() {
  if (schedulerStarted || process.env.SCHEDULER_ENABLED === 'false') return;
  schedulerStarted = true;

  cron.schedule('0 0 * * *', () => {
    runDailyEmailJobs().catch((err) => {
      console.error('daily email jobs failed', err);
    });
  }, { timezone: CENTRE_TIME_ZONE });
}
