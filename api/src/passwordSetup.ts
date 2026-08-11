import crypto from 'node:crypto';
import { PoolClient, QueryResultRow } from 'pg';
import { hashPassword } from './auth';
import { sendMailSafely, type MailSender } from './mail';
import { enrolInSession } from './sessionEnrolment';

const TOKEN_BYTES = 32;
const TOKEN_TTL_HOURS = 24;
const INITIAL_PARTICIPANT_CREDITS = 4000;

type PersonRow = QueryResultRow & {
  id: number;
  email: string;
  kind: string;
  active: boolean;
  password_hash: string | null;
};

export class PasswordSetupError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function hashSetupToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createRawSetupToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export function passwordSetupUrl(token: string): string {
  const base = (process.env.WEB_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/setup-password?token=${encodeURIComponent(token)}`;
}

export function validateNewPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 8) {
    throw new PasswordSetupError(400, 'password must be at least 8 characters');
  }
  return password;
}

export async function createPasswordSetupToken(
  client: Pick<PoolClient, 'query'>,
  personId: number,
  now: Date = new Date(),
  rawToken: string = createRawSetupToken()
) {
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await client.query(
    'update password_setup_token set used_at = now() where person_id = $1 and used_at is null',
    [personId]
  );
  await client.query(
    `insert into password_setup_token (person_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [personId, hashSetupToken(rawToken), expiresAt.toISOString()]
  );

  return { rawToken, expiresAt };
}

export async function sendPasswordSetupEmail(
  email: string,
  rawToken: string,
  sender?: MailSender
): Promise<boolean> {
  const url = passwordSetupUrl(rawToken);
  return sendMailSafely(
    {
      to: email,
      subject: 'Set up your Atrium password',
      text: [
        'Your Atrium session is booked.',
        'Set your password using this single-use link within 24 hours:',
        url
      ].join('\n\n'),
      html: `<p>Your Atrium session is booked.</p><p><a href="${url}">Set your password</a> within 24 hours.</p>`
    },
    sender
  );
}

export async function findOrCreateAnonymousParticipant(
  client: Pick<PoolClient, 'query'>,
  emailInput: unknown
) {
  const email = normalizeEmail(emailInput);
  if (!isValidEmail(email)) {
    throw new PasswordSetupError(400, 'a valid email address is required');
  }

  const existing = await client.query<PersonRow>(
    'select id, email, kind, active, password_hash from person where lower(email) = $1 for update',
    [email]
  );

  if (existing.rows.length > 0) {
    return { person: existing.rows[0], created: false };
  }

  const inserted = await client.query<PersonRow>(
    `insert into person (email, password_hash, full_name, kind, credits, active, created_at)
     values ($1, null, $2, 'participant', $3, true, now())
     returning id, email, kind, active, password_hash`,
    [email, email, INITIAL_PARTICIPANT_CREDITS]
  );

  return { person: inserted.rows[0], created: true };
}

export async function bookSessionAsAnonymousVisitor(
  client: Pick<PoolClient, 'query'>,
  sessionId: number,
  emailInput: unknown
) {
  const { person, created } = await findOrCreateAnonymousParticipant(client, emailInput);
  const enrolment = await enrolInSession(client, sessionId, person.id);
  const needsPasswordSetup = created || (person.kind === 'participant' && !person.password_hash);
  const setup = needsPasswordSetup ? await createPasswordSetupToken(client, person.id) : null;

  return {
    enrolment,
    accountCreated: created,
    setup,
    email: person.email
  };
}

export async function establishPasswordWithToken(
  client: Pick<PoolClient, 'query'>,
  rawToken: unknown,
  passwordInput: unknown,
  now: Date = new Date()
) {
  if (typeof rawToken !== 'string' || rawToken.length < 20) {
    throw new PasswordSetupError(400, 'invalid setup token');
  }

  const password = validateNewPassword(passwordInput);
  const tokens = await client.query<QueryResultRow & { id: number; person_id: number }>(
    `select id, person_id
       from password_setup_token
      where token_hash = $1
        and used_at is null
        and expires_at > $2
      for update`,
    [hashSetupToken(rawToken), now.toISOString()]
  );

  if (tokens.rows.length === 0) {
    throw new PasswordSetupError(400, 'setup link is invalid or expired');
  }

  const token = tokens.rows[0];
  const people = await client.query<PersonRow>(
    "select id, active from person where id = $1 and kind = 'participant' for update",
    [token.person_id]
  );

  if (people.rows.length === 0 || !people.rows[0].active) {
    throw new PasswordSetupError(400, 'setup link is invalid or expired');
  }

  await client.query('update person set password_hash = $1 where id = $2', [
    hashPassword(password),
    token.person_id
  ]);
  await client.query('update password_setup_token set used_at = now() where id = $1', [token.id]);

  return { personId: token.person_id };
}
