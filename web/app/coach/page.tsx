'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { centreDateKey, centreLocalDateTimeToIso, formatCentreDateKey, formatCentreRange } from '../calendarTime';
import PaginationControls from '../PaginationControls';

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

type Person = { full_name: string; email: string; kind: string; credits: string };
type Room = { id: number; name: string; capacity: number; room_type?: string };
type Attendee = {
  enrolment_id: number;
  status: string;
  full_name: string;
  email: string;
  credits_charged: string;
  credits_refunded: string;
  checked_in: boolean;
};
type OwnSession = {
  id: number;
  room_id: number;
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
  starts_at: string;
  ends_at: string;
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
type Dashboard = { own_sessions: OwnSession[]; attending: AttendingSession[]; busy: BusySession[] };
type CoachView = 'calendar' | 'teaching' | 'create' | 'available' | 'attending' | 'busy';
type RescheduleDraft = {
  date: string;
  startTime: string;
  endTime: string;
  roomId: string;
  secondTeachingRoomId: string;
  lunchRoomId: string;
  intensiveSplit: string;
  sessionType: string;
};
type CreateDraft = {
  date: string;
  startTime: string;
  endTime: string;
  discipline: string;
  sessionType: string;
  roomId: string;
  secondTeachingRoomId: string;
  lunchRoomId: string;
  intensiveSplit: string;
};

const typeLabels: Record<string, string> = { short: 'Short', standard: 'Standard', intensive: 'Intensive' };
const disciplines = ['fitness', 'lifestyle', 'financial', 'nutrition', 'career', 'mindfulness'];
const pageSize = 10;

function credits(value: string | number) {
  return `${Number(value).toFixed(0)} credits`;
}

function centreInputTime(value: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}

function draftFor(session: OwnSession): RescheduleDraft {
  return {
    date: centreDateKey(session.starts_at),
    startTime: centreInputTime(session.starts_at),
    endTime: centreInputTime(session.ends_at),
    roomId: String(session.room_id),
    secondTeachingRoomId: String(session.room_id),
    lunchRoomId: '',
    intensiveSplit: '90-90',
    sessionType: session.session_type
  };
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
    ...dashboard.busy.map((session, index) => ({
      key: `busy-${session.starts_at}-${session.ends_at}-${index}`,
      day: centreDateKey(session.starts_at),
      title: 'Busy',
      label: 'Other coach',
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      detail: 'Reserved'
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
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sessions, setSessions] = useState<PublicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<CoachView>('calendar');
  const [page, setPage] = useState(0);
  const [reschedulingId, setReschedulingId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, RescheduleDraft>>({});
  const [createDraft, setCreateDraft] = useState<CreateDraft>({
    date: '',
    startTime: '',
    endTime: '',
    discipline: disciplines[0],
    sessionType: 'standard',
    roomId: '',
    secondTeachingRoomId: '',
    lunchRoomId: '',
    intensiveSplit: '90-90'
  });

  async function loadData() {
    setError('');
    const from = new Date();
    const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
    const [meRes, dashboardRes, roomsRes, sessionsRes] = await Promise.all([
      fetch(`${apiBaseUrl}/api/me`, { credentials: 'include' }),
      fetch(`${apiBaseUrl}/api/sessions/dashboard`, { credentials: 'include' }),
      fetch(`${apiBaseUrl}/api/rooms`, { credentials: 'include' }),
      fetch(`${apiBaseUrl}/api/sessions?from=${from.toISOString()}&to=${to.toISOString()}`, {
        credentials: 'include'
      })
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

    if (roomsRes.ok) setRooms(await roomsRes.json());
    if (sessionsRes.ok) setSessions(await sessionsRes.json());

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
      setPage(0);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel session');
    } finally {
      setBusy(false);
    }
  }

  function startReschedule(session: OwnSession) {
    setError('');
    setReschedulingId(session.id);
    setDrafts((current) => ({ ...current, [session.id]: current[session.id] || draftFor(session) }));
  }

  async function rescheduleSession(session: OwnSession) {
    const draft = drafts[session.id] || draftFor(session);
    setBusy(true);
    setError('');
    try {
      const isIntensive = draft.sessionType === 'intensive';
      const res = await fetch(`${apiBaseUrl}/api/sessions/${session.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room_id: Number(draft.roomId),
          second_teaching_room_id: isIntensive && draft.secondTeachingRoomId ? Number(draft.secondTeachingRoomId) : undefined,
          lunch_room_id: isIntensive && draft.lunchRoomId ? Number(draft.lunchRoomId) : undefined,
          intensive_split: isIntensive ? draft.intensiveSplit : undefined,
          session_type: draft.sessionType,
          starts_at: centreLocalDateTimeToIso(draft.date, draft.startTime),
          ends_at: centreLocalDateTimeToIso(draft.date, draft.endTime)
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not reschedule session');
      }
      setReschedulingId(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reschedule session');
    } finally {
      setBusy(false);
    }
  }

  async function createSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const isIntensive = createDraft.sessionType === 'intensive';
      const res = await fetch(`${apiBaseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room_id: Number(createDraft.roomId),
          second_teaching_room_id: isIntensive && createDraft.secondTeachingRoomId ? Number(createDraft.secondTeachingRoomId) : undefined,
          lunch_room_id: isIntensive && createDraft.lunchRoomId ? Number(createDraft.lunchRoomId) : undefined,
          intensive_split: isIntensive ? createDraft.intensiveSplit : undefined,
          discipline: createDraft.discipline,
          session_type: createDraft.sessionType,
          starts_at: centreLocalDateTimeToIso(createDraft.date, createDraft.startTime),
          ends_at: centreLocalDateTimeToIso(createDraft.date, createDraft.endTime)
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not create session');
      }
      setCreateDraft({
        date: '',
        startTime: '',
        endTime: '',
        discipline: disciplines[0],
        sessionType: 'standard',
        roomId: '',
        secondTeachingRoomId: '',
        lunchRoomId: '',
        intensiveSplit: '90-90'
      });
      setPage(0);
      await loadData();
      setView('teaching');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create session');
    } finally {
      setBusy(false);
    }
  }

  async function bookSession(id: number) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/sessions/${id}/book`, {
        method: 'POST',
        credentials: 'include'
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not book session');
      }
      setPage(0);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book session');
    } finally {
      setBusy(false);
    }
  }

  async function setAttendance(sessionId: number, enrolmentId: number, checkedIn: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/enrolments/${enrolmentId}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ checked_in: checkedIn })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not update attendance');
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update attendance');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !person || !dashboard) return <main><p className="state">Loading...</p></main>;
  const calendarDays = Object.entries(groupCalendarItems(coachCalendarItems(dashboard))).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  const visibleCalendarDays = calendarDays.slice(page * 5, (page + 1) * 5);
  const visibleOwnSessions = dashboard.own_sessions.slice(page * pageSize, (page + 1) * pageSize);
  const visibleAttending = dashboard.attending.slice(page * pageSize, (page + 1) * pageSize);
  const visibleBusy = dashboard.busy.slice(page * pageSize, (page + 1) * pageSize);
  const ownSessionIds = new Set(dashboard.own_sessions.map((session) => session.id));
  const attendingSessionIds = new Set(dashboard.attending.map((session) => session.id));
  const availableSessions = sessions.filter(
    (session) => session.places_remaining > 0 && !ownSessionIds.has(session.id) && !attendingSessionIds.has(session.id)
  );
  const visibleAvailable = availableSessions.slice(page * pageSize, (page + 1) * pageSize);
  const teachingRooms = rooms.filter((room) => (room.room_type || 'teaching') === 'teaching');
  const lunchRooms = rooms.filter((room) => room.room_type === 'lunch_dinner');

  function selectView(nextView: CoachView) {
    setView(nextView);
    setPage(0);
  }

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>Coach dashboard</h1>
          <p>{person.full_name} - {person.email}</p>
        </div>
      </header>

      {error ? <p className="state error">{error}</p> : null}

      <section className="stat-grid" aria-label="Coach summary">
        <article className="stat-card"><span>Credit balance</span><strong>{Number(person.credits).toFixed(0)}</strong></article>
        <article className="stat-card"><span>Sessions teaching</span><strong>{dashboard.own_sessions.length}</strong></article>
        <article className="stat-card"><span>Sessions attending</span><strong>{dashboard.attending.length}</strong></article>
      </section>

      <nav className="view-tabs" aria-label="Coach dashboard sections">
        {([
          ['calendar', 'Calendar'],
          ['teaching', 'Teaching'],
          ['create', 'Create'],
          ['available', 'Available'],
          ['attending', 'Attending'],
          ['busy', 'Busy periods']
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
        <h2>Calendar</h2>
        {calendarDays.length === 0 ? <p className="state">No active calendar entries.</p> : (
          <div className="calendar-list">
            {visibleCalendarDays.map(([day, items]) => (
              <article className="calendar-day" key={day}>
                <h3>{formatCentreDateKey(day)}</h3>
                {items.map((item) => (
                  <div className="calendar-item" key={item.key}>
                    <strong className="discipline-name">{item.title}</strong>
                    <span>{item.label}</span>
                    <span>{formatCentreRange(item.starts_at, item.ends_at)}</span>
                    <span>{item.detail}</span>
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
        <PaginationControls page={page} pageSize={5} totalItems={calendarDays.length} onPageChange={setPage} />
      </section> : null}

      {view === 'teaching' ? <section className="panel">
        <h2>My upcoming sessions</h2>
        {dashboard.own_sessions.length === 0 ? <p className="state">No upcoming sessions.</p> : (
          <div className="session-list">
            {visibleOwnSessions.map((session) => (
              <article className="session-card" key={session.id}>
                <div className="session-card-head">
                  <div>
                    <h3><span className="discipline-name">{session.discipline}</span>{' '}
                      <span className={`type-badge type-${session.session_type}`}>{typeLabels[session.session_type] || session.session_type}</span>
                    </h3>
                    <p>{formatCentreRange(session.starts_at, session.ends_at)} - {session.room_name}</p>
                    <p>{session.enrolled_count} attendee{session.enrolled_count === 1 ? '' : 's'}</p>
                  </div>
                  {session.status === 'scheduled' ? (
                    <div className="button-row">
                      <button className="button-secondary" disabled={busy} onClick={() => startReschedule(session)}>Reschedule</button>
                      <button disabled={busy} onClick={() => cancelSession(session.id)}>Cancel session</button>
                    </div>
                  ) : null}
                </div>

                {reschedulingId === session.id ? (
                  <div className="reschedule-panel">
                    <label>
                      <span>Date</span>
                      <input
                        type="date"
                        value={(drafts[session.id] || draftFor(session)).date}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [session.id]: { ...(current[session.id] || draftFor(session)), date: event.target.value }
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Starts</span>
                      <input
                        type="time"
                        value={(drafts[session.id] || draftFor(session)).startTime}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [session.id]: { ...(current[session.id] || draftFor(session)), startTime: event.target.value }
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Ends</span>
                      <input
                        type="time"
                        value={(drafts[session.id] || draftFor(session)).endTime}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [session.id]: { ...(current[session.id] || draftFor(session)), endTime: event.target.value }
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Type</span>
                      <select
                        value={(drafts[session.id] || draftFor(session)).sessionType}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [session.id]: { ...(current[session.id] || draftFor(session)), sessionType: event.target.value }
                          }))
                        }
                      >
                        {Object.entries(typeLabels).map(([value, label]) => (
                          <option value={value} key={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Room</span>
                      <select
                        value={(drafts[session.id] || draftFor(session)).roomId}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [session.id]: { ...(current[session.id] || draftFor(session)), roomId: event.target.value }
                          }))
                        }
                      >
                        {teachingRooms.map((room) => (
                          <option value={room.id} key={room.id}>{room.name} ({room.capacity})</option>
                        ))}
                      </select>
                    </label>
                    {(drafts[session.id] || draftFor(session)).sessionType === 'intensive' ? (
                      <>
                        <label>
                          <span>Lunch room</span>
                          <select
                            value={(drafts[session.id] || draftFor(session)).lunchRoomId}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [session.id]: { ...(current[session.id] || draftFor(session)), lunchRoomId: event.target.value }
                              }))
                            }
                            required
                          >
                            <option value="">Select a lunch room</option>
                            {lunchRooms.map((room) => (
                              <option value={room.id} key={room.id}>{room.name} ({room.capacity})</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Second room</span>
                          <select
                            value={(drafts[session.id] || draftFor(session)).secondTeachingRoomId}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [session.id]: { ...(current[session.id] || draftFor(session)), secondTeachingRoomId: event.target.value }
                              }))
                            }
                          >
                            <option value="">Same as first room</option>
                            {teachingRooms.map((room) => (
                              <option value={room.id} key={room.id}>{room.name} ({room.capacity})</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Split</span>
                          <select
                            value={(drafts[session.id] || draftFor(session)).intensiveSplit}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [session.id]: { ...(current[session.id] || draftFor(session)), intensiveSplit: event.target.value }
                              }))
                            }
                          >
                            <option value="90-90">90 / 90</option>
                            <option value="60-120">60 / 120</option>
                            <option value="120-60">120 / 60</option>
                          </select>
                        </label>
                      </>
                    ) : null}
                    <div className="form-actions">
                      <button className="button-secondary" type="button" disabled={busy} onClick={() => setReschedulingId(null)}>Close</button>
                      <button type="button" disabled={busy} onClick={() => rescheduleSession(session)}>Save changes</button>
                    </div>
                  </div>
                ) : null}

                {session.attendees.length === 0 ? <p className="state">No attendees yet.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Paid</th><th>Refunded</th><th>Attendance</th></tr></thead>
                      <tbody>
                        {session.attendees.map((attendee) => (
                          <tr key={attendee.enrolment_id}>
                            <td>{attendee.full_name}</td>
                            <td>{attendee.email}</td>
                            <td>{attendee.status}</td>
                            <td>{credits(attendee.credits_charged)}</td>
                            <td>{credits(attendee.credits_refunded)}</td>
                            <td>
                              <label className="attendance-toggle">
                                <input
                                  checked={Boolean(attendee.checked_in)}
                                  disabled={busy || attendee.status !== 'active'}
                                  onChange={(event) =>
                                    setAttendance(session.id, attendee.enrolment_id, event.target.checked)
                                  }
                                  type="checkbox"
                                />
                                <span>{attendee.checked_in ? 'Checked in' : 'Absent'}</span>
                              </label>
                            </td>
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
        <PaginationControls page={page} pageSize={pageSize} totalItems={dashboard.own_sessions.length} onPageChange={setPage} />
      </section> : null}

      {view === 'create' ? <section className="panel form-panel">
        <h2>Create session</h2>
        <form className="form-grid" onSubmit={createSession}>
          <label>
            <span>Date</span>
            <input type="date" value={createDraft.date} onChange={(event) => setCreateDraft((current) => ({ ...current, date: event.target.value }))} required />
          </label>
          <label>
            <span>Starts</span>
            <input type="time" value={createDraft.startTime} onChange={(event) => setCreateDraft((current) => ({ ...current, startTime: event.target.value }))} required />
          </label>
          <label>
            <span>Ends</span>
            <input type="time" value={createDraft.endTime} onChange={(event) => setCreateDraft((current) => ({ ...current, endTime: event.target.value }))} required />
          </label>
          <label>
            <span>Discipline</span>
            <select value={createDraft.discipline} onChange={(event) => setCreateDraft((current) => ({ ...current, discipline: event.target.value }))}>
              {disciplines.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Type</span>
            <select value={createDraft.sessionType} onChange={(event) => setCreateDraft((current) => ({ ...current, sessionType: event.target.value }))}>
              {Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>Room</span>
            <select value={createDraft.roomId} onChange={(event) => setCreateDraft((current) => ({ ...current, roomId: event.target.value }))} required>
              <option value="">Select a room</option>
              {teachingRooms.map((room) => <option value={room.id} key={room.id}>{room.name} ({room.capacity})</option>)}
            </select>
          </label>
          {createDraft.sessionType === 'intensive' ? (
            <>
              <label>
                <span>Lunch room</span>
                <select value={createDraft.lunchRoomId} onChange={(event) => setCreateDraft((current) => ({ ...current, lunchRoomId: event.target.value }))} required>
                  <option value="">Select a lunch room</option>
                  {lunchRooms.map((room) => <option value={room.id} key={room.id}>{room.name} ({room.capacity})</option>)}
                </select>
              </label>
              <label>
                <span>Second room</span>
                <select value={createDraft.secondTeachingRoomId} onChange={(event) => setCreateDraft((current) => ({ ...current, secondTeachingRoomId: event.target.value }))}>
                  <option value="">Same as first room</option>
                  {teachingRooms.map((room) => <option value={room.id} key={room.id}>{room.name} ({room.capacity})</option>)}
                </select>
              </label>
              <label>
                <span>Split</span>
                <select value={createDraft.intensiveSplit} onChange={(event) => setCreateDraft((current) => ({ ...current, intensiveSplit: event.target.value }))}>
                  <option value="90-90">90 / 90</option>
                  <option value="60-120">60 / 120</option>
                  <option value="120-60">120 / 60</option>
                </select>
              </label>
            </>
          ) : null}
          <div className="form-actions"><button disabled={busy} type="submit">{busy ? 'Creating...' : 'Create session'}</button></div>
        </form>
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
                    <td><button disabled={busy} onClick={() => bookSession(session.id)}>Book</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationControls page={page} pageSize={pageSize} totalItems={availableSessions.length} onPageChange={setPage} />
      </section> : null}

      {view === 'attending' ? <section className="panel">
        <h2>Sessions I am attending</h2>
        {dashboard.attending.length === 0 ? <p className="state">You are not attending any upcoming sessions.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th><th>Coach</th><th>When</th><th>Room</th><th>Paid</th></tr></thead>
              <tbody>
                {visibleAttending.map((session) => (
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
        <PaginationControls page={page} pageSize={pageSize} totalItems={dashboard.attending.length} onPageChange={setPage} />
      </section> : null}

      {view === 'busy' ? <section className="panel">
        <h2>Other coach busy periods</h2>
        {dashboard.busy.length === 0 ? <p className="state">No other scheduled coach sessions.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Busy period</th></tr></thead>
              <tbody>
                {visibleBusy.map((session, index) => (
                  <tr key={`${session.starts_at}-${session.ends_at}-${index}`}>
                    <td>{formatCentreRange(session.starts_at, session.ends_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationControls page={page} pageSize={pageSize} totalItems={dashboard.busy.length} onPageChange={setPage} />
      </section> : null}
    </main>
  );
}
