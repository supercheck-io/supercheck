import { DelayedError, Job, UnrecoverableError } from 'bullmq';

/** Longest wait between attempts while an organization's slot stays occupied. */
export const CAPACITY_RETRY_MAX_DELAY_MS = 30_000;
const CAPACITY_RETRY_BASE_DELAY_MS = 1_000;
/** About six hours of waiting at the maximum delay before the job is given up. */
export const CAPACITY_DEFERRAL_LIMIT = 720;
/** Shown instead of the cluster's raw ResourceQuota text when no execution slot is free. */
export const EXECUTION_QUOTA_ERROR =
  'Execution capacity is full: the run did not start and waits for a free slot';
/** A full execution quota waits this long in total: each attempt already holds a worker for the pod wait. */
export const QUOTA_WAIT_BUDGET_MS = 30 * 60_000;

interface DeferrableData {
  _capacityDeferrals?: number;
  /** When the run first waited for a full execution quota. */
  _quotaWaitSince?: number;
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
  error?: unknown,
): Promise<never> {
  const data = job.data as DeferrableData;
  const deferrals = data._capacityDeferrals ?? 0;
  const quota =
    error instanceof Error && error.message === EXECUTION_QUOTA_ERROR;
  const quotaWaitSince = quota
    ? (data._quotaWaitSince ?? Date.now())
    : data._quotaWaitSince;
  if (quota && Date.now() - quotaWaitSince! > QUOTA_WAIT_BUDGET_MS) {
    const reason =
      'Execution capacity stayed full for 30 minutes; the run was not started';
    await onGiveUp?.(reason);
    throw new UnrecoverableError(reason);
  }
  if (deferrals >= CAPACITY_DEFERRAL_LIMIT) {
    const reason =
      'Organization execution capacity stayed occupied; the run was not started';
    await onGiveUp?.(reason);
    throw new UnrecoverableError(reason);
  }
  await job.updateData({
    ...job.data,
    _capacityDeferrals: deferrals + 1,
    ...(quotaWaitSince !== undefined
      ? { _quotaWaitSince: quotaWaitSince }
      : {}),
  });
  await job.moveToDelayed(
    Date.now() + capacityRetryDelayMs(deferrals),
    job.token,
  );
  throw new DelayedError();
}
