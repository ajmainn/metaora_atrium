import { Request } from 'express';
import { QueryResultRow } from 'pg';
import { AuthedPerson, readSession, SESSION_COOKIE } from '../auth';
import { query } from '../db';

export type AssistantRole = 'anonymous' | AuthedPerson['kind'];

export type AnonymousAssistantCaller = {
  authenticated: false;
  role: 'anonymous';
};

export type AuthenticatedAssistantCaller = {
  authenticated: true;
  role: AuthedPerson['kind'];
  person: AuthedPerson;
};

export type AssistantCallerContext = AnonymousAssistantCaller | AuthenticatedAssistantCaller;

export type AssistantQueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<T[]>;

export class AssistantAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function resolveAssistantCaller(
  req: Request,
  queryFn: AssistantQueryFn = query
): Promise<AssistantCallerContext> {
  const session = readSession(req.cookies ? req.cookies[SESSION_COOKIE] : undefined);
  if (!session) return { authenticated: false, role: 'anonymous' };

  const people = await queryFn<AuthedPerson>(
    'select id, email, full_name, kind, credits, active from person where id = $1',
    [session.personId]
  );

  if (people.length === 0) {
    throw new AssistantAuthError(401, 'not signed in');
  }

  if (!people[0].active) {
    throw new AssistantAuthError(403, 'account is inactive');
  }

  return {
    authenticated: true,
    role: people[0].kind,
    person: people[0]
  };
}
