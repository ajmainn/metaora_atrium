import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { query } from './db';

export const SESSION_COOKIE = 'atrium_session';

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

type PersonKind = 'participant' | 'coach' | 'admin';
type AuthedPerson = {
  id: number;
  email: string;
  full_name: string;
  kind: PersonKind;
  credits: string;
  active: boolean;
};

function sessionSecret(): string {
  return process.env.SESSION_SECRET || 'change-me';
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p
  });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${key.toString('hex')}`;
}

function legacyHashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) {
    return safeEqual(legacyHashPassword(password), stored);
  }

  const [, n, r, p, salt, expected] = parts;
  const key = crypto.scryptSync(password, salt, Buffer.from(expected, 'hex').length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });
  return safeEqual(key.toString('hex'), expected);
}

function dashboardFor(kind: PersonKind): string {
  if (kind === 'admin') return '/admin';
  if (kind === 'coach') return '/coach';
  return '/participant';
}

export function signSession(personId: number, issuedAt: number = Date.now()): string {
  const payload = `${personId}.${issuedAt}`;
  const mac = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

export function readSession(cookie: string | undefined): { personId: number; issuedAt: number } | null {
  if (!cookie) return null;

  const parts = cookie.split('.');
  if (parts.length !== 3) return null;

  const payload = `${parts[0]}.${parts[1]}`;
  const mac = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  if (mac !== parts[2]) return null;

  const personId = Number(parts[0]);
  const issuedAt = Number(parts[1]);
  if (!Number.isInteger(personId) || !Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > SESSION_MAX_AGE_MS) return null;

  return { personId, issuedAt };
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = readSession(req.cookies ? req.cookies[SESSION_COOKIE] : undefined);
  if (!session) {
    res.status(401).json({ error: 'not signed in' });
    return;
  }

  try {
    const people = await query<AuthedPerson>(
      'select id, email, full_name, kind, credits, active from person where id = $1',
      [session.personId]
    );

    if (people.length === 0) {
      res.status(401).json({ error: 'not signed in' });
      return;
    }

    if (!people[0].active) {
      res.status(403).json({ error: 'account is inactive' });
      return;
    }

    res.locals.personId = people[0].id;
    res.locals.person = people[0];
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not verify the session' });
  }
}

export function requireRole(...roles: PersonKind[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const person = res.locals.person as AuthedPerson | undefined;
    if (!person) {
      res.status(401).json({ error: 'not signed in' });
      return;
    }
    if (!roles.includes(person.kind)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

export async function login(req: Request, res: Response): Promise<void> {
  const email = req.body ? req.body.email : undefined;
  const password = req.body ? req.body.password : undefined;

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  try {
    const people = await query(
      'select id, email, full_name, kind, password_hash, active from person where email = $1',
      [email]
    );

    if (people.length === 0) {
      res.status(401).json({ error: 'no such user' });
      return;
    }

    const person = people[0];
    if (!person.active) {
      res.status(403).json({ error: 'account is inactive' });
      return;
    }

    if (!verifyPassword(password, person.password_hash)) {
      res.status(401).json({ error: 'wrong password' });
      return;
    }

    if (!person.password_hash.startsWith('scrypt$')) {
      await query('update person set password_hash = $1 where id = $2', [hashPassword(password), person.id]);
    }

    res.cookie(SESSION_COOKIE, signSession(person.id), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS
    });

    res.json({
      id: person.id,
      email: person.email,
      full_name: person.full_name,
      kind: person.kind,
      dashboard: dashboardFor(person.kind)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not sign in' });
  }
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ signed_out: true });
}

export async function me(_req: Request, res: Response): Promise<void> {
  res.json(res.locals.person);
}
