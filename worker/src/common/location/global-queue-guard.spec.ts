import { Logger } from '@nestjs/common';
import type { Worker } from 'bullmq';
import { GlobalQueueCapabilityGuard } from './global-queue-guard';

describe('GlobalQueueCapabilityGuard', () => {
  const logger = { warn: jest.fn(), log: jest.fn() } as unknown as Logger;

  function setup(execute: jest.Mock) {
    const worker = {
      pause: jest.fn().mockResolvedValue(undefined),
      resume: jest.fn(),
    };
    const guard = new GlobalQueueCapabilityGuard(
      () => worker as unknown as Worker,
      { db: { execute } },
      'us-east',
      'browser',
      logger,
    );
    return { guard, worker };
  }

  beforeEach(() => jest.clearAllMocks());

  it('pauses the global consumer when its own location lacks the capability', async () => {
    const { guard, worker } = setup(
      jest
        .fn()
        .mockResolvedValue([{ supports_browser: false, supports_k6: false }]),
    );
    await guard.check();
    expect(worker.pause).toHaveBeenCalledWith(true);
    await guard.check();
    expect(worker.pause).toHaveBeenCalledTimes(1);
  });

  it('resumes when the capability is turned back on', async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([{ supports_browser: false, supports_k6: false }])
      .mockResolvedValueOnce([{ supports_browser: true, supports_k6: false }]);
    const { guard, worker } = setup(execute);
    await guard.check();
    await guard.check();
    expect(worker.resume).toHaveBeenCalledTimes(1);
  });

  it('leaves a capable location untouched', async () => {
    const { guard, worker } = setup(
      jest
        .fn()
        .mockResolvedValue([{ supports_browser: true, supports_k6: true }]),
    );
    await guard.check();
    expect(worker.pause).not.toHaveBeenCalled();
    expect(worker.resume).not.toHaveBeenCalled();
  });

  it("keeps today's behaviour for a location with no row (unregistered self-hosted location)", async () => {
    const { guard, worker } = setup(jest.fn().mockResolvedValue([]));
    await guard.check();
    expect(worker.pause).not.toHaveBeenCalled();
  });

  it('keeps its current state on a DB error instead of pausing every worker', async () => {
    const { guard, worker } = setup(
      jest.fn().mockRejectedValue(new Error('db down')),
    );
    await guard.check();
    expect(worker.pause).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('treats a database without the capability columns as capable', async () => {
    const missing = Object.assign(
      new Error('column "supports_browser" does not exist'),
      { code: '42703' },
    );
    const { guard, worker } = setup(jest.fn().mockRejectedValue(missing));
    await guard.check();
    expect(worker.pause).not.toHaveBeenCalled();
  });

  it('retries pausing on the next check when pause fails', async () => {
    const { guard, worker } = setup(
      jest
        .fn()
        .mockResolvedValue([{ supports_browser: false, supports_k6: false }]),
    );
    worker.pause.mockRejectedValueOnce(new Error('redis down'));
    await guard.check();
    await guard.check();
    expect(worker.pause).toHaveBeenCalledTimes(2);
  });
});
