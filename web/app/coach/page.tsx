'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { centreDateKey, formatCentreDateKey, formatCentreRange } from '../calendarTime';

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

type Person = { full_name: string; email: string; kind: string; credits: string };
type Attendee = {
  enrolment_id: number;
  status: string;
  full_name: string;
  email: string;
  credits_charged: string;
  credits_refunded: string;
};
type OwnSession = {
  id: number;
  discipline: string;
  session_type: string;
  status: string;
  starts_at: string;
  ends_at: string;
  room_name: string;
  enrolled_count: number;
  attendees: Attendee[];
};
type AttendingSession = {
  id: number;
  enrolment_id: number;
  discipline: string;
  session_type: string;
  starts_at: string;
  ends_at: string;
  room_name: string;
  coach_name: string;
  credits_charged: string;
};
type BusySession = {
  id: number;
  discipline: string;
  session_type: string;
  starts_at: string;
  ends_at: string;
};
type Dashboard = { own_sessions: OwnSession[]; attending: AttendingSession[]; busy: BusySession[] };

const typeLabels: Record<string, string> = { short: 'Short', standard: 'Standard', intensive: 'Intensive' };

function credits(value: string | number) {
  return `${Number(value).toFixed(0)} credits`;
}

type CalendarItem = {
  key: string;
  day: string;
  title: string;
  label: string;
  starts_at: string;
  ends_at: string;
  detail: string;
};

function coachCalendarItems(dashboard: Dashboard) {
  const items: CalendarItem[] = [
    ...dashboard.own_sessions
      .filter((session) => session.status === 'scheduled')
      .map((session) => ({
        key: `own-${session.id}`,
        day: centreDateKey(session.starts_at),
        title: session.discipline,
        label: 'Teaching',
        starts_at: session.starts_at,
        ends_at: session.ends_at,
        detail: `${typeLabels[session.session_type] || session.session_type} - ${session.room_name}`
      })),
    ...dashboard.attending.map((session) => ({
      key: `attending-${session.enrolment_id}`,
      day: centreDateKey(session.starts_at),
      title: session.discipline,
      label: 'Attending',
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      detail: `${typeLabels[session.session_type] || session.session_type} - ${session.room_name}`
    })),
    ...dashboard.busy.map((session) => ({
      key: `busy-${session.id}`,
      day: centreDateKey(session.starts_at),
      title: 'Busy',
      label: 'Other coach',
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      detail: typeLabels[session.session_type] || session.session_type
    }))
  ];

  return items.sort((left, right) => left.starts_at.localeCompare(right.starts_at));
}

function groupCalendarItems(items: CalendarItem[]) {
  return items.reduce<Record<string, CalendarItem[]>>((groups, item) => {
    groups[item.day] = groups[item.day] || [];
    groups[item.day].push(item);
    return groups;
  }, {});
}

export default function CoachDashboard() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadData() {
    setError('');
    const [meRes, dashboardRes] = await Promise.all([
      fetch(`${apiBaseUrl}/api/me`, { credentials: 'include' }),
      fetch(`${apiBaseUrl}/api/sessions/dashboard`, { credentials: 'include' })
    ]);

    if (!meRes.ok) {
      router.push('/login');
      return;
    }

    const me: Person = await meRes.json();
    if (me.kind !== 'coach') {
      router.push(me.kind === 'admin' ? '/admin' : '/participant');
      return;
    }

    if (!dashboardRes.ok) {
      throw new Error('Could not load dashboard');
    }

    setPerson(me);
    setDashboard(await dashboardRes.json());
  }

  useEffect(() => {
    loadData()
      .catch(() => setError('Could not load your dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  async function cancelSession(id: number) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/sessions/${id}/cancel`, {
        method: 'POST',
        credentials: 'include'
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not cancel session');
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel session');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !person || !dashboard) return <main><p className="state">Loading...</p></main>;
  const calendarDays = Object.entries(groupCalendarItems(coachCalendarItems(dashboard))).sort(
    ([left], [right]) => left.localeCompare(right)
  );

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>Coach dashboard</h1>
          <p>{person.full_name} - {person.email}</p>
        </div>
        <strong>{credits(person.credits)}</strong>
      </header>

      {error ? <p className="state error">{error}</p> : null}

      <section className="panel">
        <h2>Calendar</h2>
        {calendarDays.length === 0 ? <p className="state">No active calendar entries.</p> : (
          <div className="calendar-list">
            {calendarDays.map(([day, items]) => (
              <article className="calendar-day" key={day}>
                <h3>{formatCentreDateKey(day)}</h3>
                {items.map((item) => (
                  <div className="calendar-item" key={item.key}>
                    <strong>{item.title}</strong>
                    <span>{item.label}</span>
                    <span>{formatCentreRange(item.starts_at, item.ends_at)}</span>
                    <span>{item.detail}</span>
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>My upcoming sessions</h2>
        {dashboard.own_sessions.length === 0 ? <p className="state">No upcoming sessions.</p> : (
          <div className="session-list">
            {dashboard.own_sessions.map((session) => (
              <article className="session-card" key={session.id}>
                <div className="session-card-head">
                  <div>
                    <h3>{session.discipline} ({typeLabels[session.session_type] || session.session_type})</h3>
                    <p>{formatCentreRange(session.starts_at, session.ends_at)} - {session.room_name}</p>
                    <p>{session.enrolled_count} attendee{session.enrolled_count === 1 ? '' : 's'}</p>
                  </div>
                  {session.status === 'scheduled' ? (
                    <button disabled={busy} onClick={() => cancelSession(session.id)}>Cancel session</button>
                  ) : null}
                </div>

                {session.attendees.length === 0 ? <p className="state">No attendees yet.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Paid</th><th>Refunded</th></tr></thead>
                      <tbody>
                        {session.attendees.map((attendee) => (
                          <tr key={attendee.enrolment_id}>
                            <td>{attendee.full_name}</td>
                            <td>{attendee.email}</td>
                            <td>{attendee.status}</td>
                            <td>{credits(attendee.credits_charged)}</td>
                            <td>{credits(attendee.credits_refunded)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Sessions I am attending</h2>
        {dashboard.attending.length === 0 ? <p className="state">You are not attending any upcoming sessions.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th><th>Coach</th><th>When</th><th>Room</th><th>Paid</th></tr></thead>
              <tbody>
                {dashboard.attending.map((session) => (
                  <tr key={session.enrolment_id}>
                    <td>{session.discipline} ({typeLabels[session.session_type] || session.session_type})</td>
                    <td>{session.coach_name}</td>
                    <td>{formatCentreRange(session.starts_at, session.ends_at)}</td>
                    <td>{session.room_name}</td>
                    <td>{credits(session.credits_charged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Other coach busy periods</h2>
        {dashboard.busy.length === 0 ? <p className="state">No other scheduled coach sessions.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Discipline</th><th>Type</th><th>Busy period</th></tr></thead>
              <tbody>
                {dashboard.busy.map((session) => (
                  <tr key={session.id}>
                    <td>{session.discipline}</td>
                    <td>{typeLabels[session.session_type] || session.session_type}</td>
                    <td>{formatCentreRange(session.starts_at, session.ends_at)}</td>
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
