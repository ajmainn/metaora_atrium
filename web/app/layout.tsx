import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import SiteHeader from './SiteHeader';

export const metadata: Metadata = {
  title: 'Atrium'
};

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en">
      <body>
        <SiteHeader user={user} />
        {children}
      </body>
    </html>
  );
}
