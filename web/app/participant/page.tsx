'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { centreDateKey, formatCentreDateKey, formatCentreRange } from '../calendarTime';
import PaginationControls from '../PaginationControls';

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
type ParticipantView = 'calendar' | 'upcoming' | 'available' | 'history';

const typeLabels: Record<string, string> = { short: 'Short', standard: 'Standard', intensive: 'Intensive' };
const pageSize = 10;

function credits(value: string | number) {
  return `${Number(value).toFixed(0)} credits`;
}

function groupBookingsByDate(bookings: Booking[]) {
  return bookings.reduce<Record<string, Booking[]>>((groups, booking) => {
    const key = centreDateKey(booking.starts_at);
    groups[key] = groups[key] || [];
    groups[key].push(booking);
    return groups;
  }, {});
}

export default function ParticipantDashboard() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [sessions, setSessions] = useState<PublicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<ParticipantView>('calendar');
  const [page, setPage] = useState(0);

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
      setPage(0);
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
  const calendarDays = Object.entries(groupBookingsByDate(dashboard.upcoming_bookings)).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  const visibleCalendarDays = calendarDays.slice(page * 5, (page + 1) * 5);
  const visibleUpcoming = dashboard.upcoming_bookings.slice(page * pageSize, (page + 1) * pageSize);
  const visibleAvailable = availableSessions.slice(page * pageSize, (page + 1) * pageSize);
  const visibleHistory = dashboard.history.slice(page * pageSize, (page + 1) * pageSize);

  function selectView(nextView: ParticipantView) {
    setView(nextView);
    setPage(0);
  }

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>Participant dashboard</h1>
          <p>{person.full_name} - {person.email}</p>
        </div>
      </header>

      {error ? <p className="state error">{error}</p> : null}

      <section className="stat-grid" aria-label="Participant summary">
        <article className="stat-card"><span>Credit balance</span><strong>{Number(person.credits).toFixed(0)}</strong></article>
        <article className="stat-card"><span>Upcoming bookings</span><strong>{dashboard.upcoming_bookings.length}</strong></article>
        <article className="stat-card"><span>Available sessions</span><strong>{availableSessions.length}</strong></article>
      </section>

      <nav className="view-tabs" aria-label="Participant dashboard sections">
        {([
          ['calendar', 'Calendar'],
          ['upcoming', 'Upcoming'],
          ['available', 'Available'],
          ['history', 'History']
        ] as const).map(([value, label]) => (
          <button
            className={view === value ? 'active' : undefined}
            type="button"
            aria-pressed={view === value}
            onClick={() => selectView(value)}
            key={value}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === 'calendar' ? <section className="panel">
        <h2>My calendar</h2>
        {calendarDays.length === 0 ? <p className="state">No active bookings on your calendar.</p> : (
          <div className="calendar-list">
            {visibleCalendarDays.map(([day, bookings]) => (
              <article className="calendar-day" key={day}>
                <h3>{formatCentreDateKey(day)}</h3>
                {bookings.map((booking) => (
                  <div className="calendar-item" key={booking.enrolment_id}>
                    <strong className="discipline-name">{booking.discipline}</strong>
                    <span><span className={`type-badge type-${booking.session_type}`}>{typeLabels[booking.session_type] || booking.session_type}</span></span>
                    <span>{formatCentreRange(booking.starts_at, booking.ends_at)}</span>
                    <span>{booking.room_name}</span>
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
        <PaginationControls page={page} pageSize={5} totalItems={calendarDays.length} onPageChange={setPage} />
      </section> : null}

      {view === 'upcoming' ? <section className="panel">
        <h2>Upcoming bookings</h2>
        {dashboard.upcoming_bookings.length === 0 ? <p className="state">No upcoming bookings.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th><th>When</th><th>Room</th><th>Paid</th><th></th></tr></thead>
              <tbody>
                {visibleUpcoming.map((booking) => (
                  <tr key={booking.enrolment_id}>
                    <td>{booking.discipline} ({typeLabels[booking.session_type] || booking.session_type})</td>
                    <td>{formatCentreRange(booking.starts_at, booking.ends_at)}</td>
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
        <PaginationControls page={page} pageSize={pageSize} totalItems={dashboard.upcoming_bookings.length} onPageChange={setPage} />
      </section> : null}

      {view === 'available' ? <section className="panel">
        <h2>Available sessions</h2>
        {availableSessions.length === 0 ? <p className="state">No available sessions in the next 14 days.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th><th>When</th><th>Room</th><th>Fee</th><th>Places</th><th></th></tr></thead>
              <tbody>
                {visibleAvailable.map((session) => (
                  <tr key={session.id}>
                    <td>{session.discipline} ({typeLabels[session.session_type] || session.session_type})</td>
                    <td>{formatCentreRange(session.starts_at, session.ends_at)}</td>
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
        <PaginationControls page={page} pageSize={pageSize} totalItems={availableSessions.length} onPageChange={setPage} />
      </section> : null}

      {view === 'history' ? <section className="panel">
        <h2>Past and cancelled bookings</h2>
        {dashboard.history.length === 0 ? <p className="state">No past or cancelled bookings.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th><th>When</th><th>Status</th><th>Paid</th><th>Refunded</th></tr></thead>
              <tbody>
                {visibleHistory.map((booking) => (
                  <tr key={booking.enrolment_id}>
                    <td>{booking.discipline}</td>
                    <td>{formatCentreRange(booking.starts_at, booking.ends_at)}</td>
                    <td>{booking.enrolment_status} / {booking.status}</td>
                    <td>{credits(booking.credits_charged)}</td>
                    <td>{credits(booking.credits_refunded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationControls page={page} pageSize={pageSize} totalItems={dashboard.history.length} onPageChange={setPage} />
      </section> : null}
    </main>
  );
}
