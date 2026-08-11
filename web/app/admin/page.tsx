'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Room = { id: number; name: string; capacity: number };
type Person = { id: number; full_name: string; email: string; kind: string };
type Session = { id: number; starts_at: string; ends_at: string };
type Me = { kind: string };

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((me: Me) => {
        if (me.kind !== 'admin') {
          router.push(me.kind === 'coach' ? '/coach' : '/participant');
          return;
        }
        setAuthorized(true);
      })
      .catch(() => router.push('/login'));
  }, [router]);

  useEffect(() => {
    if (!authorized) return;

    const from = startOfWeek(new Date());
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

    fetch(`${apiBaseUrl}/api/rooms`, { credentials: 'include' })
      .then((res) => res.json())
      .then(setRooms);

    fetch(`${apiBaseUrl}/api/people`, { credentials: 'include' })
      .then((res) => res.json())
      .then(setPeople);

    fetch(
      `${apiBaseUrl}/api/sessions?from=${from.toISOString()}&to=${to.toISOString()}`,
      { credentials: 'include' }
    )
      .then((res) => res.json())
      .then(setSessions);
  }, [authorized]);

  if (!authorized) return <main><p className="state">Loading...</p></main>;

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>Admin dashboard</h1>
          <p>Centre overview for the current week</p>
        </div>
      </header>
      <section className="stat-grid" aria-label="Centre summary">
        <article className="stat-card"><span>Rooms</span><strong>{rooms.length}</strong></article>
        <article className="stat-card"><span>Sessions this week</span><strong>{sessions.length}</strong></article>
        <article className="stat-card"><span>People</span><strong>{people.length}</strong></article>
      </section>
      <section className="panel quick-actions">
        <h2>Quick actions</h2>
        <a className="button-link" href="/admin/sessions">Open session calendar</a>
      </section>
    </main>
  );
}
