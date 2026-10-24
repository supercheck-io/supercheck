import { DelayedError, Job, UnrecoverableError } from 'bullmq';

/** Longest wait between attempts while an organization's slot stays occupied. */
export const CAPACITY_RETRY_MAX_DELAY_MS = 30_000;
const CAPACITY_RETRY_BASE_DELAY_MS = 1_000;
/** About six hours of waiting at the maximum delay before the job is given up. */
export const CAPACITY_DEFERRAL_LIMIT = 720;

interface DeferrableData {
  _capacityDeferrals?: number;
}

/** Exponential backoff with jitter, so waiting jobs do not retry in lockstep. */
export function capacityRetryDelayMs(
  deferrals: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(
    CAPACITY_RETRY_MAX_DELAY_MS,
    CAPACITY_RETRY_BASE_DELAY_MS * 2 ** Math.min(deferrals, 5),
  );
  return Math.round(base * (0.75 + random() * 0.5));
}

/**
 * Re-queues a job whose organization has no free execution slot, without
 * consuming a BullMQ attempt. The wait is bounded: a slot that never frees up
 * ends the job instead of looping forever, and `onGiveUp` can record why.
 * Always throws (DelayedError to wait, UnrecoverableError to give up).
 */
export async function deferForCapacity<T extends object>(
  job: Job<T>,
  onGiveUp?: (reason: string) => Promise<void>,
): Promise<never> {
  const deferrals = (job.data as DeferrableData)._capacityDeferrals ?? 0;
  if (deferrals >= CAPACITY_DEFERRAL_LIMIT) {
    const reason =
      'Organization execution capacity stayed occupied; the run was not started';
    await onGiveUp?.(reason);
    throw new UnrecoverableError(reason);
  }
  await job.updateData({
    ...job.data,
    _capacityDeferrals: deferrals + 1,
  });
  await job.moveToDelayed(
    Date.now() + capacityRetryDelayMs(deferrals),
    job.token,
  );
  throw new DelayedError();
}
