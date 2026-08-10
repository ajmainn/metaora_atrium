import { Router } from 'express';
import { query, withTransaction } from '../db';
import { requireRole, requireSession } from '../auth';
import { applyCoachCancellation } from '../sessionCancellation';
import { createSessionBooking, SessionCreationError } from '../sessionCreation';

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
