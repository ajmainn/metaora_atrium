import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookSessionAsAnonymousVisitor,
  establishPasswordWithToken,
  hashSetupToken,
  isValidEmail,
  normalizeEmail,
  PasswordSetupError
} from '../src/passwordSetup';
import { verifyPassword } from '../src/auth';
import { SessionEnrolmentError } from '../src/sessionEnrolment';

type FakeOptions = {
  existingPerson?: { id: number; email: string; kind?: string; credits: number; active?: boolean; password_hash?: string | null };
  duplicate?: boolean;
  activeEnrolments?: number;
  token?: { id: number; person_id: number; raw: string; expires_at: string; used_at?: string | null };
  tokenPersonActive?: boolean;
};

function fakeClient(options: FakeOptions = {}) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const insertedPeople: Array<{ email: string; credits: number }> = [];
  const insertedTokens: Array<{ token_hash: string; rawSeen: boolean }> = [];
  let nextPersonId = 90;
  let passwordHash = options.existingPerson?.password_hash || null;

  return {
    calls,
    insertedPeople,
    insertedTokens,
    get passwordHash() {
      return passwordHash;
    },
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });

      if (text.includes('from person where lower(email)')) {
        if (!options.existingPerson) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              id: options.existingPerson.id,
              email: options.existingPerson.email,
              kind: options.existingPerson.kind || 'participant',
              active: options.existingPerson.active ?? true,
              password_hash: options.existingPerson.password_hash || null
            }
          ],
          rowCount: 1
        };
      }

      if (text.startsWith('insert into person')) {
        insertedPeople.push({ email: params[0] as string, credits: Number(params[2]) });
        return {
          rows: [{ id: nextPersonId++, email: params[0], kind: 'participant', active: true, password_hash: null }],
          rowCount: 1
        };
      }

      if (text.includes('from session s') && text.includes('join room')) {
        return {
          rows: [
            {
              id: params[0],
              coach_id: 20,
              status: 'scheduled',
              starts_at: '2026-09-10T14:00:00Z',
              ends_at: '2026-09-10T15:00:00Z',
              seat_fee_credits: '20',
              room_capacity: 2
            }
          ],
          rowCount: 1
        };
      }

      if (text.includes("from person where id = $1 and kind in ('participant', 'coach')")) {
        const person = options.existingPerson || { id: params[0] as number, credits: 4000, active: true };
        return person.active === false
          ? { rows: [], rowCount: 0 }
          : { rows: [{ id: params[0], credits: String(person.credits) }], rowCount: 1 };
      }

      if (text.includes('where session_id = $1 and person_id = $2')) {
        return { rows: options.duplicate ? [{ id: 7 }] : [], rowCount: options.duplicate ? 1 : 0 };
      }

      if (text.includes('count(*)::int as enrolled_count')) {
        return { rows: [{ enrolled_count: options.activeEnrolments ?? 0 }], rowCount: 1 };
      }

      if (text.includes('from session') && text.includes('coach_id = $1')) {
        return { rows: [], rowCount: 0 };
      }

      if (text.includes('from enrolment e')) {
        return { rows: [], rowCount: 0 };
      }

      if (text.startsWith('update person set credits')) {
        const person = options.existingPerson || { credits: 4000 };
        return Number(person.credits) >= Number(params[0])
          ? { rows: [{ credits: Number(person.credits) - Number(params[0]) }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (text.startsWith('insert into enrolment')) {
        return {
          rows: [
            {
              id: 33,
              session_id: params[0],
              person_id: params[1],
              status: 'active',
              credits_charged: params[2],
              credits_refunded: 0,
              enrolled_at: '2026-09-01T12:00:00Z',
              cancelled_at: null
            }
          ],
          rowCount: 1
        };
      }

      if (text.startsWith('update password_setup_token set used_at')) {
        return { rows: [], rowCount: 1 };
      }

      if (text.startsWith('insert into password_setup_token')) {
        insertedTokens.push({ token_hash: params[1] as string, rawSeen: (params[1] as string).includes('raw-token') });
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('from password_setup_token')) {
        const token = options.token;
        if (!token || token.used_at || token.expires_at <= (params[1] as string) || params[0] !== hashSetupToken(token.raw)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [{ id: token.id, person_id: token.person_id }], rowCount: 1 };
      }

      if (text.includes("from person where id = $1 and kind = 'participant'")) {
        return options.tokenPersonActive === false
          ? { rows: [], rowCount: 0 }
          : { rows: [{ id: params[0], active: true }], rowCount: 1 };
      }

      if (text.startsWith('update person set password_hash')) {
        passwordHash = params[0] as string;
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }
  };
}

test('email normalization is case-insensitive and validation rejects invalid input', () => {
  assert.equal(normalizeEmail('  Visitor@Example.COM '), 'visitor@example.com');
  assert.equal(isValidEmail('visitor@example.com'), true);
  assert.equal(isValidEmail('visitor'), false);
});

test('anonymous booking creates one participant with 4000 credits and stores only a token hash', async () => {
  const client = fakeClient();
  const result = await bookSessionAsAnonymousVisitor(client as any, 12, 'New.Visitor@Example.com');

  assert.equal(result.accountCreated, true);
  assert.equal(result.enrolment.id, 33);
  assert.deepEqual(client.insertedPeople, [{ email: 'new.visitor@example.com', credits: 4000 }]);
  assert.equal(client.insertedTokens.length, 1);
  assert.match(client.insertedTokens[0].token_hash, /^[a-f0-9]{64}$/);
  assert.equal(client.insertedTokens[0].rawSeen, false);
});

test('anonymous booking reuses an existing account without issuing initial credits or setup token', async () => {
  const client = fakeClient({
    existingPerson: { id: 55, email: 'visitor@example.com', credits: 100 }
  });

  const result = await bookSessionAsAnonymousVisitor(client as any, 12, 'VISITOR@example.com');

  assert.equal(result.accountCreated, false);
  assert.equal(result.enrolment.person_id, 55);
  assert.equal(client.insertedPeople.length, 0);
  assert.equal(client.insertedTokens.length, 0);
});

test('invalid and insufficient anonymous bookings are rejected by existing validation paths', async () => {
  await assert.rejects(
    () => bookSessionAsAnonymousVisitor(fakeClient() as any, 12, 'not-an-email'),
    (error) => error instanceof PasswordSetupError && /valid email/.test(error.message)
  );

  await assert.rejects(
    () =>
      bookSessionAsAnonymousVisitor(
        fakeClient({ existingPerson: { id: 55, email: 'visitor@example.com', credits: 10 } }) as any,
        12,
        'visitor@example.com'
      ),
    (error) => error instanceof SessionEnrolmentError && /insufficient credits/.test(error.message)
  );
});

test('setup token establishes a scrypt password and cannot be reused after use or expiry', async () => {
  const raw = 'raw-token-that-is-long-enough';
  const client = fakeClient({
    token: { id: 4, person_id: 55, raw, expires_at: '2026-09-11T00:00:00.000Z' }
  });

  const result = await establishPasswordWithToken(client as any, raw, 'new-password', new Date('2026-09-10T00:00:00.000Z'));

  assert.equal(result.personId, 55);
  assert.equal(client.passwordHash?.startsWith('scrypt$'), true);
  assert.equal(verifyPassword('new-password', client.passwordHash || ''), true);

  await assert.rejects(
    () =>
      establishPasswordWithToken(
        fakeClient({ token: { id: 4, person_id: 55, raw, expires_at: '2026-09-11T00:00:00.000Z', used_at: '2026-09-10T00:01:00.000Z' } }) as any,
        raw,
        'new-password',
        new Date('2026-09-10T00:02:00.000Z')
      ),
    (error) => error instanceof PasswordSetupError && /invalid or expired/.test(error.message)
  );

  await assert.rejects(
    () =>
      establishPasswordWithToken(
        fakeClient({ token: { id: 4, person_id: 55, raw, expires_at: '2026-09-09T00:00:00.000Z' } }) as any,
        raw,
        'new-password',
        new Date('2026-09-10T00:00:00.000Z')
      ),
    (error) => error instanceof PasswordSetupError && /invalid or expired/.test(error.message)
  );
});
