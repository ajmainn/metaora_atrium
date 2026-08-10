import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

function dashboardFor(kind: string) {
  if (kind === 'admin') return '/admin';
  if (kind === 'coach') return '/coach';
  return '/participant';
}

export default async function ParticipantLayout({ children }: { children: React.ReactNode }) {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${apiBaseUrl}/api/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store'
  });

  if (!res.ok) redirect('/login');

  const me = await res.json();
  if (me.kind !== 'participant') redirect(dashboardFor(me.kind));

  return children;
}
