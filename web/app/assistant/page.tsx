import { cookies } from 'next/headers';
import AssistantChat from './AssistantChat';

type CurrentUser = {
  full_name: string;
  email: string;
  kind: 'admin' | 'coach' | 'participant';
};

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

async function currentUser(): Promise<CurrentUser | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${apiBaseUrl}/api/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store'
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export default async function AssistantPage() {
  const user = await currentUser();

  return (
    <main className="assistant-page">
      <AssistantChat user={user} />
    </main>
  );
}
