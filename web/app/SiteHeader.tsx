'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

type CurrentUser = {
  full_name: string;
  email: string;
  kind: 'admin' | 'coach' | 'participant';
};

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

const roleLabels = {
  admin: 'Admin',
  coach: 'Coach',
  participant: 'Participant'
};

function dashboardFor(kind: CurrentUser['kind']) {
  if (kind === 'admin') return '/admin';
  if (kind === 'coach') return '/coach';
  return '/participant';
}

export default function SiteHeader({ user }: { user: CurrentUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const links = [
    { href: '/', label: 'Sessions' },
    ...(user ? [{ href: dashboardFor(user.kind), label: 'Dashboard' }] : []),
    ...(user?.kind === 'admin' ? [{ href: '/admin/sessions', label: 'Calendar' }] : [])
  ];

  async function logout() {
    setSigningOut(true);
    try {
      await fetch(`${apiBaseUrl}/api/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      router.push('/');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/" aria-label="Atrium sessions">
          Atrium
        </Link>

        <nav className="site-nav" aria-label="Primary navigation">
          {links.map((link) => (
            <Link
              className={pathname === link.href ? 'active' : undefined}
              href={link.href}
              key={link.href}
              aria-current={pathname === link.href ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="account-nav">
          {user ? (
            <>
              <div className="account-copy">
                <span className="role-badge">{roleLabels[user.kind]}</span>
                <span className="account-name">{user.full_name}</span>
                <span className="account-email">{user.email}</span>
              </div>
              <button className="button-secondary" type="button" onClick={logout} disabled={signingOut}>
                {signingOut ? 'Logging out...' : 'Log out'}
              </button>
            </>
          ) : (
            <Link className={pathname === '/login' ? 'login-link active' : 'login-link'} href="/login">
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
