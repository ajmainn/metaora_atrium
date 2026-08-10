'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

type Person = { full_name: string; email: string; kind: string; credits: string };
type Booking = {
  id: number;
  enrolment_id: number;
  discipline: string;
  session_type: string;
  status: string;
  enrolment_status: string;
  starts_at: string;
  ends_at: string;
  room_name: string;
  seat_fee_credits: string;
  credits_charged: string;
  credits_refunded: string;
};
type PublicSession = {
  id: number;
  discipline: string;
  session_type: string;
  starts_at: string;
  ends_at: string;
  room_name: string;
  room_capacity: number;
  places_remaining: number;
  seat_fee_credits: string;
};
type Dashboard = { upcoming_bookings: Booking[]; history: Booking[] };

const centreTimeZone = 'America/New_York';
const typeLabels: Record<string, string> = { short: 'Short', standard: 'Standard', intensive: 'Intensive' };

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: centreTimeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatRange(start: string, end: string) {
  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
}

function credits(value: string | number) {
  return `${Number(value).toFixed(0)} credits`;
}

export default function ParticipantDashboard() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [sessions, setSessions] = useState<PublicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadData() {
    setError('');
    const from = new Date();
    const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [meRes, dashboardRes, sessionsRes] = await Promise.all([
      fetch(`${apiBaseUrl}/api/me`, { credentials: 'include' }),
      fetch(`${apiBaseUrl}/api/sessions/dashboard`, { credentials: 'include' }),
      fetch(`${apiBaseUrl}/api/sessions?from=${from.toISOString()}&to=${to.toISOString()}`, {
        credentials: 'include'
      })
    ]);

    if (!meRes.ok) {
      router.push('/login');
      return;
    }

    const me: Person = await meRes.json();
    if (me.kind !== 'participant') {
      router.push(me.kind === 'admin' ? '/admin' : '/coach');
      return;
    }

    if (!dashboardRes.ok || !sessionsRes.ok) {
      throw new Error('Could not load dashboard');
    }

    setPerson(me);
    setDashboard(await dashboardRes.json());
    setSessions(await sessionsRes.json());
  }

  useEffect(() => {
    loadData()
      .catch(() => setError('Could not load your dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  async function act(url: string, fallback: string) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || fallback);
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !person || !dashboard) return <main><p className="state">Loading...</p></main>;

  const bookedSessionIds = new Set(dashboard.upcoming_bookings.map((booking) => booking.id));
  const availableSessions = sessions.filter(
    (session) => session.places_remaining > 0 && !bookedSessionIds.has(session.id)
  );

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>Participant dashboard</h1>
          <p>{person.full_name} - {person.email}</p>
        </div>
        <strong>{credits(person.credits)}</strong>
      </header>

      {error ? <p className="state error">{error}</p> : null}

      <section className="panel">
        <h2>Upcoming bookings</h2>
        {dashboard.upcoming_bookings.length === 0 ? <p className="state">No upcoming bookings.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th><th>When</th><th>Room</th><th>Paid</th><th></th></tr></thead>
              <tbody>
                {dashboard.upcoming_bookings.map((booking) => (
                  <tr key={booking.enrolment_id}>
                    <td>{booking.discipline} ({typeLabels[booking.session_type] || booking.session_type})</td>
                    <td>{formatRange(booking.starts_at, booking.ends_at)}</td>
                    <td>{booking.room_name}</td>
                    <td>{credits(booking.credits_charged)}</td>
                    <td>
                      <button
                        disabled={busy}
                        onClick={() => act(`${apiBaseUrl}/api/sessions/${booking.id}/enrolments/${booking.enrolment_id}/cancel`, 'Could not cancel booking')}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Available sessions</h2>
        {availableSessions.length === 0 ? <p className="state">No available sessions in the next 14 days.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th><th>When</th><th>Room</th><th>Fee</th><th>Places</th><th></th></tr></thead>
              <tbody>
                {availableSessions.map((session) => (
                  <tr key={session.id}>
                    <td>{session.discipline} ({typeLabels[session.session_type] || session.session_type})</td>
                    <td>{formatRange(session.starts_at, session.ends_at)}</td>
                    <td>{session.room_name}</td>
                    <td>{credits(session.seat_fee_credits)}</td>
                    <td>{session.places_remaining} of {session.room_capacity}</td>
                    <td>
                      <button disabled={busy} onClick={() => act(`${apiBaseUrl}/api/sessions/${session.id}/book`, 'Could not book session')}>
                        Book
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Past and cancelled bookings</h2>
        {dashboard.history.length === 0 ? <p className="state">No past or cancelled bookings.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th><th>When</th><th>Status</th><th>Paid</th><th>Refunded</th></tr></thead>
              <tbody>
                {dashboard.history.map((booking) => (
                  <tr key={booking.enrolment_id}>
                    <td>{booking.discipline}</td>
                    <td>{formatRange(booking.starts_at, booking.ends_at)}</td>
                    <td>{booking.enrolment_status} / {booking.status}</td>
                    <td>{credits(booking.credits_charged)}</td>
                    <td>{credits(booking.credits_refunded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
