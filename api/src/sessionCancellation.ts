import { PoolClient } from 'pg';
import { hoursOfNotice, refundAmount, refundPercent } from './credits';

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
};

export type CoachCancellationSummary = {
  refundPercent: number;
  roomRefund: number;
  enrolmentsCancelled: number;
  seatsRefunded: number;
};

export async function applyCoachCancellation(
  client: Pick<PoolClient, 'query'>,
  session: SessionForCancellation,
  cancelledAt: Date = new Date()
): Promise<CoachCancellationSummary> {
  const percent = refundPercent(hoursOfNotice(cancelledAt, new Date(session.starts_at)));
  const roomRefund = refundAmount(Number(session.room_fee_credits), percent);

  const enrolments = await client.query<ActiveEnrolment>(
    "select id, person_id, credits_charged from enrolment where session_id = $1 and status = 'active'",
    [session.id]
  );

  let seatsRefunded = 0;

  for (const enrolment of enrolments.rows) {
    const refund = refundAmount(Number(enrolment.credits_charged), 1);

    await client.query(
      `update enrolment
          set status = 'cancelled', credits_refunded = $1, cancelled_at = now()
        where id = $2`,
      [refund, enrolment.id]
    );

    await client.query('update person set credits = credits + $1 where id = $2', [
      refund,
      enrolment.person_id
    ]);

    seatsRefunded += refund;
  }

  await client.query('update person set credits = credits + $1 where id = $2', [
    roomRefund,
    session.coach_id
  ]);

  await client.query("update session set status = 'cancelled' where id = $1", [session.id]);

  return {
    refundPercent: percent,
    roomRefund,
    enrolmentsCancelled: enrolments.rowCount || enrolments.rows.length,
    seatsRefunded
  };
}
