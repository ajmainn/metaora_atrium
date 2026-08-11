import { PoolClient } from 'pg';
import { hoursOfNotice, refundAmount, refundPercent } from './credits';
import type { AffectedParticipant } from './emailNotifications';

type SessionForCancellation = {
  id: number;
  coach_id: number;
  room_fee_credits: string | number;
  starts_at: string | Date;
};

type ActiveEnrolment = {
  id: number;
  person_id: number;
  credits_charged: string | number;
  full_name: string;
  email: string;
};

export type CoachCancellationSummary = {
  refundPercent: number;
  roomRefund: number;
  enrolmentsCancelled: number;
  seatsRefunded: number;
  affectedParticipants: AffectedParticipant[];
};

export async function applyCoachCancellation(
  client: Pick<PoolClient, 'query'>,
  session: SessionForCancellation,
  cancelledAt: Date = new Date()
): Promise<CoachCancellationSummary> {
  const percent = refundPercent(hoursOfNotice(cancelledAt, new Date(session.starts_at)));
  const roomRefund = refundAmount(Number(session.room_fee_credits), percent);

  const enrolments = await client.query<ActiveEnrolment>(
    `select e.id, e.person_id, e.credits_charged, p.full_name, p.email
      from enrolment e
       join person p on p.id = e.person_id
      where e.session_id = $1 and e.status = 'active'
      for update of e`,
    [session.id]
  );

  let seatsRefunded = 0;
  const affectedParticipants: AffectedParticipant[] = [];

  for (const enrolment of enrolments.rows) {
    const refund = refundAmount(Number(enrolment.credits_charged), 1);

    const updated = await client.query(
      `update enrolment
          set status = 'cancelled', credits_refunded = $1, cancelled_at = $2
        where id = $3 and status = 'active'
        returning id`,
      [refund, cancelledAt.toISOString(), enrolment.id]
    );

    if (updated.rows.length === 0) continue;

    await client.query('update person set credits = credits + $1 where id = $2', [
      refund,
      enrolment.person_id
    ]);

    seatsRefunded += refund;
    affectedParticipants.push({
      personId: enrolment.person_id,
      fullName: enrolment.full_name,
      email: enrolment.email,
      refund
    });
  }

  await client.query('update person set credits = credits + $1 where id = $2', [
    roomRefund,
    session.coach_id
  ]);

  await client.query("update session set status = 'cancelled' where id = $1", [session.id]);

  return {
    refundPercent: percent,
    roomRefund,
    enrolmentsCancelled: affectedParticipants.length,
    seatsRefunded,
    affectedParticipants
  };
}
