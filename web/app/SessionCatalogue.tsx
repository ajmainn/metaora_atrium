'use client';

import { useState } from 'react';
import PaginationControls from './PaginationControls';

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

export type CatalogueSession = {
  id: number;
  discipline: string;
  session_type: string;
  starts_at: string;
  ends_at: string;
  room_capacity: number;
  places_remaining: number;
  seat_fee_credits: string;
};

const pageSize = 10;
const centreTimeZone = 'America/New_York';
const typeLabels: Record<string, string> = {
  short: 'Short',
  standard: 'Standard',
  intensive: 'Intensive'
};
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: centreTimeZone,
  weekday: 'short',
  month: 'short',
  day: 'numeric'
});
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: centreTimeZone,
  hour: 'numeric',
  minute: '2-digit'
});

function formatTimeRange(start: string, end: string) {
  return `${timeFormatter.format(new Date(start))} - ${timeFormatter.format(new Date(end))}`;
}

export default function SessionCatalogue({ sessions }: { sessions: CatalogueSession[] }) {
  const [page, setPage] = useState(0);
  const [emails, setEmails] = useState<Record<number, string>>({});
  const [messages, setMessages] = useState<Record<number, { kind: 'ok' | 'error'; text: string }>>({});
  const [busySessionId, setBusySessionId] = useState<number | null>(null);
  const visibleSessions = sessions.slice(page * pageSize, (page + 1) * pageSize);

  async function book(sessionId: number) {
    setBusySessionId(sessionId);
    setMessages((current) => ({ ...current, [sessionId]: { kind: 'ok', text: '' } }));

    try {
      const res = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/book-anonymous`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emails[sessionId] || '' })
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(body.error || 'Could not book that session.');

      setMessages((current) => ({
        ...current,
        [sessionId]: {
          kind: 'ok',
          text: body.account_created
            ? 'Booked. Check your email for the password setup link.'
            : 'Booked. Use your existing account to manage it.'
        }
      }));
    } catch (err) {
      setMessages((current) => ({
        ...current,
        [sessionId]: { kind: 'error', text: err instanceof Error ? err.message : 'Could not book that session.' }
      }));
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <>
      <div className="table-wrap">
        <table className="session-table">
          <thead>
            <tr>
              <th>Discipline</th>
              <th>Date</th>
              <th>Time</th>
              <th>Type</th>
              <th>Participant fee</th>
              <th>Places remaining</th>
              <th>Book by email</th>
            </tr>
          </thead>
          <tbody>
            {visibleSessions.map((session) => (
              <tr key={session.id}>
                <td><strong className="discipline-name">{session.discipline}</strong></td>
                <td>{dateFormatter.format(new Date(session.starts_at))}</td>
                <td>{formatTimeRange(session.starts_at, session.ends_at)}</td>
                <td>
                  <span className={`type-badge type-${session.session_type}`}>
                    {typeLabels[session.session_type] || session.session_type}
                  </span>
                </td>
                <td>{Number(session.seat_fee_credits).toFixed(0)} credits</td>
                <td className="places-cell">
                  <strong>{session.places_remaining}</strong>
                  <span> of {session.room_capacity}</span>
                </td>
                <td>
                  <div className="inline-booking">
                    <input
                      type="email"
                      value={emails[session.id] || ''}
                      onChange={(event) =>
                        setEmails((current) => ({ ...current, [session.id]: event.target.value }))
                      }
                      placeholder="you@example.com"
                      aria-label={`Email for ${session.discipline}`}
                      disabled={session.places_remaining <= 0 || busySessionId === session.id}
                    />
                    <button
                      type="button"
                      onClick={() => book(session.id)}
                      disabled={session.places_remaining <= 0 || busySessionId === session.id}
                    >
                      {busySessionId === session.id ? 'Booking...' : 'Book'}
                    </button>
                  </div>
                  {messages[session.id]?.text ? (
                    <p className={`inline-message ${messages[session.id].kind === 'error' ? 'error-text' : ''}`}>
                      {messages[session.id].text}
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationControls
        page={page}
        pageSize={pageSize}
        totalItems={sessions.length}
        onPageChange={setPage}
      />
    </>
  );
}
