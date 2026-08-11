'use client';

import { useState } from 'react';
import PaginationControls from './PaginationControls';

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
  const visibleSessions = sessions.slice(page * pageSize, (page + 1) * pageSize);

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
