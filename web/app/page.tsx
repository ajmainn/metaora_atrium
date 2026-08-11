import SessionCatalogue, { CatalogueSession } from './SessionCatalogue';

export const dynamic = 'force-dynamic';

type Session = CatalogueSession;

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';
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
          <SessionCatalogue sessions={sessions} />
        ) : null}
      </section>

      <section className="policy-grid">
        <details className="policy-section">
          <summary>Fee schedule</summary>
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
        </details>

        <details className="policy-section">
          <summary>Booking and refunds</summary>
          <ul>
            <li>Coaches must book rooms at least 48 hours before a session starts.</li>
            <li>Coach room refunds: 96h+ 100%, 48-96h 50%, 24-48h 25%, under 24h 0%.</li>
            <li>Participant refunds: 48h+ 100%, 24-48h 50%, 12-24h 25%, under 12h 0%.</li>
            <li>If a coach cancels, participants receive a 100% refund.</li>
            <li>One room holds one session at a time; nobody may have overlapping commitments.</li>
            <li>Room capacity counts participants only. A coach cannot enrol in their own session.</li>
          </ul>
        </details>
      </section>
    </main>
  );
}
