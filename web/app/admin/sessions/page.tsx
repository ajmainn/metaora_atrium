'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  addDaysToDateKey,
  centreDateKey,
  centreHour,
  centreLocalDateTimeToIso,
  dateKeyToDate,
  formatCentreDateKey,
  startOfCentreWeekKey
} from '../../calendarTime';

type Room = { id: number; name: string; capacity: number };
type Person = { id: number; full_name: string; email: string; kind: string };
type Session = {
  id: number;
  discipline: string;
  session_type: string;
  status: string;
  starts_at: string;
  ends_at: string;
  room_name: string;
  room_capacity: number;
  coach_name: string;
  enrolled_count: number;
  places_remaining: number;
};
type Me = { kind: string };
type AdminCalendarView = 'schedule' | 'create';

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

const disciplines = [
  'fitness',
  'lifestyle',
  'financial',
  'nutrition',
  'career',
  'mindfulness'
];

const sessionTypes = ['short', 'standard', 'intensive'];

const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const dayMilliseconds = 24 * 60 * 60 * 1000;

export default function AdminSessions() {
  const router = useRouter();
  const [weekStartKey, setWeekStartKey] = useState(() => startOfCentreWeekKey(new Date()));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<AdminCalendarView>('schedule');

  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [discipline, setDiscipline] = useState(disciplines[0]);
  const [sessionType, setSessionType] = useState(sessionTypes[1]);
  const [roomId, setRoomId] = useState('');
  const [coachId, setCoachId] = useState('');

  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => addDaysToDateKey(weekStartKey, offset));
  const todayKey = centreDateKey(new Date());

  async function loadSessions() {
    if (!authorized) return;

    const from = new Date(dateKeyToDate(weekStartKey).getTime() - dayMilliseconds);
    const to = new Date(dateKeyToDate(addDaysToDateKey(weekStartKey, 7)).getTime() + dayMilliseconds);

    try {
      const res = await fetch(
        `${apiBaseUrl}/api/sessions?from=${from.toISOString()}&to=${to.toISOString()}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Could not load sessions.');
      setSessions(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sessions.');
    }
  }

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
    loadSessions();
  }, [weekStartKey, authorized]);

  useEffect(() => {
    if (!authorized) return;

    fetch(`${apiBaseUrl}/api/rooms`, { credentials: 'include' })
      .then((res) => res.json())
      .then(setRooms);

    fetch(`${apiBaseUrl}/api/people`, { credentials: 'include' })
      .then((res) => res.json())
      .then(setPeople);
  }, [authorized]);

  function sessionsFor(day: string, hour: number) {
    return sessions.filter((session) => {
      return centreDateKey(session.starts_at) === day && centreHour(session.starts_at) === hour;
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authorized) return;

    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room_id: Number(roomId),
          coach_id: Number(coachId),
          discipline,
          session_type: sessionType,
          starts_at: centreLocalDateTimeToIso(date, startTime),
          ends_at: centreLocalDateTimeToIso(date, endTime)
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not create session.');
      }
      await loadSessions();
      setView('schedule');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create session.');
    }
  }

  if (!authorized) return <main><p className="state">Loading...</p></main>;

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>Session calendar</h1>
          <p>Weekly schedule in New York time</p>
        </div>
      </header>

      {error ? <p className="state error">{error}</p> : null}

      <nav className="view-tabs" aria-label="Session calendar sections">
        <button
          className={view === 'schedule' ? 'active' : undefined}
          type="button"
          aria-pressed={view === 'schedule'}
          onClick={() => setView('schedule')}
        >
          Weekly schedule
        </button>
        <button
          className={view === 'create' ? 'active' : undefined}
          type="button"
          aria-pressed={view === 'create'}
          onClick={() => setView('create')}
        >
          Create session
        </button>
      </nav>

      {view === 'schedule' ? <section className="panel compact-panel">
      <div className="calendar-controls" aria-label="Calendar week controls">
        <button className="button-secondary" onClick={() => setWeekStartKey(addDaysToDateKey(weekStartKey, -7))}>
          Previous week
        </button>
        <strong>{formatCentreDateKey(weekStartKey)} - {formatCentreDateKey(days[6])}</strong>
        <button className="button-secondary" onClick={() => setWeekStartKey(addDaysToDateKey(weekStartKey, 7))}>
          Next week
        </button>
      </div>

      <div className="calendar-scroll" tabIndex={0} aria-label="Weekly session calendar">
      <table className="calendar">
        <thead>
          <tr>
            <th className="hour"></th>
            {days.map((day) => (
              <th className={day === todayKey ? 'current-day' : undefined} key={day}>
                {formatCentreDateKey(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hours.map((hour) => (
            <tr key={hour}>
              <th className="hour">{hour}:00</th>
              {days.map((day) => (
                <td className={day === todayKey ? 'current-day' : undefined} key={day}>
                  {sessionsFor(day, hour).map((session) => (
                    <div className="entry" key={session.id}>
                      <strong>{session.discipline}</strong>
                      <span>{session.room_name}</span>
                      <small>{session.enrolled_count} / {session.room_capacity} places</small>
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      </section> : null}

      {view === 'create' ? <section className="panel form-panel">
      <h2>Create a session</h2>
      <form className="form-grid" onSubmit={onSubmit}>
        <label>
          <span>Date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label>
          <span>Starts</span>
          <input
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            required
          />
        </label>
        <label>
          <span>Ends</span>
          <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required />
        </label>
        <label>
          <span>Discipline</span>
          <select value={discipline} onChange={(event) => setDiscipline(event.target.value)}>
            {disciplines.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Type</span>
          <select value={sessionType} onChange={(event) => setSessionType(event.target.value)}>
            {sessionTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Room</span>
          <select value={roomId} onChange={(event) => setRoomId(event.target.value)} required>
            <option value="">Select a room</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Coach</span>
          <select value={coachId} onChange={(event) => setCoachId(event.target.value)} required>
            <option value="">Select a coach</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions"><button type="submit">Create session</button></div>
      </form>
      </section> : null}
    </main>
  );
}
