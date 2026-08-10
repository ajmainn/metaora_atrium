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
    <main>
      <h1>Dashboard</h1>
      <table className="counts">
        <thead>
          <tr>
            <th>Rooms</th>
            <th>Sessions this week</th>
            <th>People</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{rooms.length}</td>
            <td>{sessions.length}</td>
            <td>{people.length}</td>
          </tr>
        </tbody>
      </table>
      <p>
        <a href="/admin/sessions">Session calendar</a>
      </p>
    </main>
  );
}
