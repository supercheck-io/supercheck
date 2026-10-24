import { DelayedError, UnrecoverableError } from 'bullmq';
import {
  CAPACITY_DEFERRAL_LIMIT,
  CAPACITY_RETRY_MAX_DELAY_MS,
  capacityRetryDelayMs,
  deferForCapacity,
} from './capacity-deferral';

function fakeJob(data: Record<string, unknown> = {}) {
  return {
    data,
    token: 'token',
    updateData: jest.fn().mockResolvedValue(undefined),
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  };
}

describe('capacityRetryDelayMs', () => {
  it('backs off exponentially from one second', () => {
    const delays = [0, 1, 2, 3].map((n) => capacityRetryDelayMs(n, () => 0.5));
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  it('never waits longer than the maximum, even with jitter', () => {
    for (const n of [5, 10, 500]) {
      expect(capacityRetryDelayMs(n, () => 1)).toBeLessThanOrEqual(
        CAPACITY_RETRY_MAX_DELAY_MS * 1.25,
      );
      expect(capacityRetryDelayMs(n, () => 0)).toBeGreaterThanOrEqual(
        CAPACITY_RETRY_MAX_DELAY_MS * 0.75,
      );
    }
  });

  it('spreads waiting jobs apart instead of retrying in lockstep', () => {
    expect(capacityRetryDelayMs(2, () => 0)).toBeLessThan(
      capacityRetryDelayMs(2, () => 1),
    );
  });
});

describe('deferForCapacity', () => {
  it('re-queues the job, counts the deferral and does not consume an attempt', async () => {
    const job = fakeJob({ runId: 'run' });
    await expect(deferForCapacity(job as never)).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.updateData).toHaveBeenCalledWith({
      runId: 'run',
      _capacityDeferrals: 1,
    });
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
  });

  it('keeps counting across deferrals', async () => {
    const job = fakeJob({ _capacityDeferrals: 7 });
    await expect(deferForCapacity(job as never)).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.updateData).toHaveBeenCalledWith({ _capacityDeferrals: 8 });
  });

  it('gives up at the limit, records why, and ends the job for good', async () => {
    const job = fakeJob({ _capacityDeferrals: CAPACITY_DEFERRAL_LIMIT });
    const onGiveUp = jest.fn().mockResolvedValue(undefined);
    await expect(
      deferForCapacity(job as never, onGiveUp),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(onGiveUp).toHaveBeenCalledWith(
      expect.stringContaining('capacity stayed occupied'),
    );
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  it('still ends the job when no give-up handler is supplied', async () => {
    const job = fakeJob({ _capacityDeferrals: CAPACITY_DEFERRAL_LIMIT + 1 });
    await expect(deferForCapacity(job as never)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
