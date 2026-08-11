'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

export default function SetupPassword() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '');
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords must match.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/account/setup-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(body.error || 'Could not set your password.');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set your password.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="auth-page">
        <div className="auth-panel">
          <h1>Password set</h1>
          <p>Your Atrium password is ready. Log in to manage your bookings and credits.</p>
          <p><Link className="button-link" href="/login">Log in</Link></p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <h1>Set password</h1>
        <p>Create the password for the Atrium account attached to your booking.</p>
        <form onSubmit={onSubmit}>
          <label>
            <span>New password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label>
            <span>Confirm password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {error ? <p className="state error">{error}</p> : null}
          {!token ? <p className="state error">This setup link is missing a token.</p> : null}
          <button type="submit" disabled={busy || !token}>
            {busy ? 'Saving...' : 'Set password'}
          </button>
        </form>
      </div>
    </main>
  );
}
