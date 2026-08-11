export const dynamic = 'force-dynamic';

type Session = {
  id: number;
  discipline: string;
  session_type: string;
  starts_at: string;
  ends_at: string;
  room_capacity: number;
  places_remaining: number;
  seat_fee_credits: string;
};

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';
const centreTimeZone = 'America/New_York';

const typeLabels: Record<string, string> = {
  short: 'Short',
  standard: 'Standard',
  intensive: 'Intensive'
};

const roomFees = [
  ['Short', '45 min', '30 credits'],
  ['Standard', '60 min', '40 credits'],
  ['Intensive', '210 min room hold, 180 min teaching', '120 credits']
];

const seatFees = [
  ['Short', '15 credits'],
  ['Standard', '20 credits'],
  ['Intensive', '60 credits']
];

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

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function formatTimeRange(start: string, end: string) {
  return `${timeFormatter.format(new Date(start))} - ${timeFormatter.format(new Date(end))}`;
}

function credits(value: string) {
  return `${Number(value).toFixed(0)} credits`;
}

export default async function PublicSessions() {
  const from = new Date();
  const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);

  let sessions: Session[] = [];
  let error = '';

  try {
    const res = await fetch(
      `${apiBaseUrl}/api/sessions?from=${from.toISOString()}&to=${to.toISOString()}`,
      { cache: 'no-store' }
    );

    if (!res.ok) {
      throw new Error('Could not load sessions');
    }

    sessions = await res.json();
  } catch {
    error = 'Sessions are not available right now. Please try again shortly.';
  }

  return (
    <main className="public-page">
      <section className="intro">
        <h1>Atrium session catalogue</h1>
        <p>
          Upcoming sessions are shown in New York time. Atrium is open Monday to Saturday,
          07:00 to 21:00, and closed on Sundays.
        </p>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Upcoming sessions</h2>
            <p>Availability for the next 14 days</p>
          </div>
        </div>
        {error ? <p className="state error">{error}</p> : null}
        {!error && sessions.length === 0 ? (
          <p className="state">No sessions are available in the next 14 days.</p>
        ) : null}
        {!error && sessions.length > 0 ? (
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
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td><strong className="discipline-name">{session.discipline}</strong></td>
                    <td>{formatDate(session.starts_at)}</td>
                    <td>{formatTimeRange(session.starts_at, session.ends_at)}</td>
                    <td>
                      <span className={`type-badge type-${session.session_type}`}>
                        {typeLabels[session.session_type] || session.session_type}
                      </span>
                    </td>
                    <td>{credits(session.seat_fee_credits)}</td>
                    <td className="places-cell">
                      <strong>{session.places_remaining}</strong>
                      <span> of {session.room_capacity}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="policy-grid">
        <div className="policy-section">
          <h2>Fee schedule</h2>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Length</th>
                <th>Coach room fee</th>
              </tr>
            </thead>
            <tbody>
              {roomFees.map(([type, length, fee]) => (
                <tr key={type}>
                <td><span className={`type-badge type-${type.toLowerCase()}`}>{type}</span></td>
                  <td>{length}</td>
                  <td>{fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Participant fee</th>
              </tr>
            </thead>
            <tbody>
              {seatFees.map(([type, fee]) => (
                <tr key={type}>
                <td><span className={`type-badge type-${type.toLowerCase()}`}>{type}</span></td>
                  <td>{fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="policy-section">
          <h2>Booking and refunds</h2>
          <ul>
            <li>Coaches must book rooms at least 48 hours before a session starts.</li>
            <li>Coach room refunds: 96h+ 100%, 48-96h 50%, 24-48h 25%, under 24h 0%.</li>
            <li>Participant refunds: 48h+ 100%, 24-48h 50%, 12-24h 25%, under 12h 0%.</li>
            <li>If a coach cancels, participants receive a 100% refund.</li>
            <li>One room holds one session at a time; nobody may have overlapping commitments.</li>
            <li>Room capacity counts participants only. A coach cannot enrol in their own session.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
