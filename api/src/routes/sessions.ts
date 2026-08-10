import { Router } from 'express';
import { query, withTransaction } from '../db';
import { requireRole, requireSession } from '../auth';
import { applyCoachCancellation } from '../sessionCancellation';
import { createSessionBooking, SessionCreationError } from '../sessionCreation';
import { cancelOwnEnrolment, enrolInSession, SessionEnrolmentError } from '../sessionEnrolment';
import {
  notifyCoachCancelledSession,
  notifyParticipantBooked,
  notifyParticipantCancelled,
  notifySessionCreated
} from '../emailNotifications';

const router = Router();

const UPDATABLE_FIELDS = [
  'room_id',
  'coach_id',
  'discipline',
  'session_type',
  'status',
  'starts_at',
  'ends_at'
];

async function notifyAfterSuccess(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} notification failed`, err);
  }
}

router.get('/', async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : new Date().toISOString();
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : null;

    const params: unknown[] = [from];
    let sql = `select
                      s.id,
                      s.discipline,
                      s.session_type,
                      s.starts_at,
                      s.ends_at,
                      s.seat_fee_credits,
                      r.name as room_name,
                      r.capacity as room_capacity,
                      count(e.id)::int as enrolled_count,
                      (r.capacity - count(e.id))::int as places_remaining
                 from session s
                 join room r on r.id = s.room_id
                 left join enrolment e on e.session_id = s.id and e.status = 'active'
                where s.starts_at >= $1
                  and s.status = 'scheduled'`;

    if (to) {
      params.push(to);
      sql += ` and s.starts_at < $${params.length}`;
    }

    sql += `
             group by s.id, r.id
             order by s.starts_at`;

    const sessions = await query(sql, params);
    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the calendar' });
  }
});

router.get('/dashboard', requireSession, async (_req, res) => {
  try {
    const person = res.locals.person;
    const now = new Date().toISOString();
    const isUpcoming = (value: unknown) => new Date(value as string | Date).getTime() >= Date.now();

    if (person.kind === 'participant') {
      const bookings = await query(
        `select e.id as enrolment_id, e.status as enrolment_status, e.credits_charged,
                e.credits_refunded, e.enrolled_at, e.cancelled_at,
                s.id, s.discipline, s.session_type, s.status, s.starts_at, s.ends_at,
                s.seat_fee_credits, r.name as room_name
           from enrolment e
           join session s on s.id = e.session_id
           join room r on r.id = s.room_id
          where e.person_id = $1
          order by s.starts_at`,
        [person.id]
      );

      res.json({
        upcoming_bookings: bookings.filter(
          (booking) => booking.enrolment_status === 'active' && booking.status === 'scheduled' && isUpcoming(booking.starts_at)
        ),
        history: bookings.filter(
          (booking) => booking.enrolment_status !== 'active' || booking.status !== 'scheduled' || !isUpcoming(booking.starts_at)
        )
      });
      return;
    }

    if (person.kind === 'coach') {
      const ownSessions = await query(
        `select s.id, s.discipline, s.session_type, s.status, s.starts_at, s.ends_at,
                s.seat_fee_credits, r.name as room_name,
                count(e.id)::int as enrolled_count
           from session s
           join room r on r.id = s.room_id
           left join enrolment e on e.session_id = s.id and e.status = 'active'
          where s.coach_id = $1 and s.starts_at >= $2
          group by s.id, r.id
          order by s.starts_at`,
        [person.id, now]
      );

      const ownSessionIds = ownSessions.map((session) => session.id);
      const attendees =
        ownSessionIds.length === 0
          ? []
          : await query(
              `select e.session_id, e.id as enrolment_id, e.status, e.credits_charged,
                      e.credits_refunded, e.enrolled_at, e.cancelled_at,
                      p.id as person_id, p.full_name, p.email
                 from enrolment e
                 join person p on p.id = e.person_id
                where e.session_id = any($1::int[])
                order by e.session_id, p.full_name`,
              [ownSessionIds]
            );

      const attending = await query(
        `select e.id as enrolment_id, e.status as enrolment_status, e.credits_charged,
                e.credits_refunded, e.enrolled_at, e.cancelled_at,
                s.id, s.discipline, s.session_type, s.status, s.starts_at, s.ends_at,
                s.seat_fee_credits, r.name as room_name, c.full_name as coach_name
           from enrolment e
           join session s on s.id = e.session_id
           join room r on r.id = s.room_id
           join person c on c.id = s.coach_id
          where e.person_id = $1 and e.status = 'active' and s.status = 'scheduled'
          order by s.starts_at`,
        [person.id]
      );

      const busy = await query(
        `select s.id, s.discipline, s.session_type, s.starts_at, s.ends_at
           from session s
          where s.coach_id <> $1 and s.status = 'scheduled' and s.starts_at >= $2
          order by s.starts_at`,
        [person.id, now]
      );

      res.json({
        own_sessions: ownSessions.map((session) => ({
          ...session,
          attendees: attendees.filter((attendee) => attendee.session_id === session.id)
        })),
        attending,
        busy
      });
      return;
    }

    res.status(403).json({ error: 'forbidden' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load dashboard sessions' });
  }
});

router.get('/:id', requireSession, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const sessions = await query('select * from session where id = $1', [id]);

    if (sessions.length === 0) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const session = sessions[0];
    const rooms = await query('select id, name, capacity from room where id = $1', [session.room_id]);
    const person = res.locals.person;
    const isAdmin = person.kind === 'admin';
    const isCoachOwner = person.kind === 'coach' && person.id === session.coach_id;

    const response: Record<string, unknown> = {
      ...session,
      room: rooms.length > 0 ? rooms[0] : null
    };

    if (isAdmin || isCoachOwner) {
      const coaches = await query('select id, full_name, email from person where id = $1', [session.coach_id]);
      const attendees = await query(
        `select e.id, e.status, e.credits_charged, e.credits_refunded, e.enrolled_at, e.cancelled_at,
                p.id as person_id, p.full_name, p.email
           from enrolment e
           join person p on p.id = e.person_id
          where e.session_id = $1
          order by e.id`,
        [id]
      );

      response.coach = coaches.length > 0 ? coaches[0] : null;
      response.attendees = attendees;
    } else if (person.kind === 'coach') {
      response.busy = true;
    } else {
      const ownEnrolments = await query(
        `select id, status, credits_charged, credits_refunded, enrolled_at, cancelled_at
           from enrolment
          where session_id = $1 and person_id = $2
          order by id`,
        [id, person.id]
      );

      if (ownEnrolments.length === 0) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }

      response.enrolments = ownEnrolments;
    }

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the session' });
  }
});

router.post('/', requireSession, requireRole('admin', 'coach'), async (req, res) => {
  try {
    const body = req.body || {};
    const person = res.locals.person;
    const { room_id, discipline, session_type, starts_at, ends_at } = body;
    const coach_id = person.kind === 'admin' ? body.coach_id : person.id;

    if (!room_id || !coach_id || !discipline || !session_type || !starts_at || !ends_at) {
      res.status(400).json({
        error: 'room_id, coach_id, discipline, session_type, starts_at and ends_at are all required'
      });
      return;
    }

    const roomId = Number(room_id);
    const coachId = Number(coach_id);
    if (!Number.isInteger(roomId) || !Number.isInteger(coachId)) {
      res.status(400).json({ error: 'room_id and coach_id must be valid ids' });
      return;
    }

    const created = await withTransaction(
      (client) =>
        createSessionBooking(client, {
          room_id: roomId,
          coach_id: coachId,
          discipline,
          session_type,
          starts_at,
          ends_at
        }),
      { isolationLevel: 'serializable' }
    );

    await notifyAfterSuccess('session created', () => notifySessionCreated(created.id));

    res.status(201).json(created);
  } catch (err) {
    if (err instanceof SessionCreationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    if ((err as { code?: string }).code === '40001') {
      res.status(409).json({ error: 'booking conflict, please retry' });
      return;
    }

    console.error(err);
    res.status(500).json({ error: 'could not create the session' });
  }
});

router.patch('/:id', requireSession, requireRole('admin', 'coach'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const body = req.body || {};
    const existing = await query('select coach_id from session where id = $1', [id]);
    if (existing.length === 0) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    if (res.locals.person.kind !== 'admin' && existing[0].coach_id !== res.locals.person.id) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const field of UPDATABLE_FIELDS) {
      if (body[field] !== undefined) {
        if (field === 'coach_id' && res.locals.person.kind !== 'admin') {
          continue;
        }
        params.push(body[field]);
        assignments.push(`${field} = $${params.length}`);
      }
    }

    if (assignments.length === 0) {
      res.status(400).json({ error: 'nothing to update' });
      return;
    }

    params.push(id);

    const updated = await query(
      `update session set ${assignments.join(', ')} where id = $${params.length} returning *`,
      params
    );

    if (updated.length === 0) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not update the session' });
  }
});

router.post('/:id/book', requireSession, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const enrolment = await withTransaction(
      (client) => enrolInSession(client, id, res.locals.personId),
      { isolationLevel: 'serializable' }
    );

    await notifyAfterSuccess('participant booked', () => notifyParticipantBooked(enrolment.id));

    res.status(201).json(enrolment);
  } catch (err) {
    if (err instanceof SessionEnrolmentError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'session is already booked by this person' });
      return;
    }

    if ((err as { code?: string }).code === '40001') {
      res.status(409).json({ error: 'booking conflict, please retry' });
      return;
    }

    console.error(err);
    res.status(500).json({ error: 'could not book the session' });
  }
});

router.post('/:id/enrolments/:enrolmentId/cancel', requireSession, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const enrolmentId = Number(req.params.enrolmentId);
    if (!Number.isInteger(id) || !Number.isInteger(enrolmentId)) {
      res.status(404).json({ error: 'no such enrolment' });
      return;
    }

    const enrolment = await withTransaction(
      (client) => cancelOwnEnrolment(client, id, enrolmentId, res.locals.personId),
      { isolationLevel: 'serializable' }
    );

    await notifyAfterSuccess('participant cancelled', () =>
      notifyParticipantCancelled(enrolment.id, enrolment.credits_refunded_now)
    );

    res.json(enrolment);
  } catch (err) {
    if (err instanceof SessionEnrolmentError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    if ((err as { code?: string }).code === '40001') {
      res.status(409).json({ error: 'cancellation conflict, please retry' });
      return;
    }

    console.error(err);
    res.status(500).json({ error: 'could not cancel the enrolment' });
  }
});

router.post('/:id/cancel', requireSession, requireRole('admin', 'coach'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const sessions = await query('select * from session where id = $1', [id]);

    if (sessions.length === 0) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const session = sessions[0];
    if (res.locals.person.kind !== 'admin' && session.coach_id !== res.locals.person.id) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    if (session.status === 'cancelled') {
      res.status(409).json({ error: 'that session is already cancelled' });
      return;
    }

    const summary = await withTransaction((client) => applyCoachCancellation(client, session));

    await notifyAfterSuccess('coach cancelled session', () =>
      notifyCoachCancelledSession(id, summary.affectedParticipants)
    );

    res.json({
      id,
      status: 'cancelled',
      refund_percent: summary.refundPercent,
      room_fee_refunded: summary.roomRefund,
      enrolments_cancelled: summary.enrolmentsCancelled,
      seat_fees_refunded: summary.seatsRefunded
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not cancel the session' });
  }
});

export default router;
