import { StalledJobHandlerService } from './stalled-job-handler.service';

describe('StalledJobHandlerService', () => {
  it.each([
    ['fresh callback', new Date(), null, false, false, false],
    [
      'stale callback with live pod',
      new Date(Date.now() - 180_000),
      null,
      true,
      false,
      true,
    ],
    [
      'stale callback after queue/pod loss',
      new Date(Date.now() - 180_000),
      null,
      false,
      true,
      true,
    ],
    ['legacy active queue', null, null, false, false, false],
  ])(
    'preserves execution liveness during recovery: %s',
    async (_name, heartbeatAt, finishedAt, podActive, recover, checkPod) => {
      const transaction = jest.fn().mockResolvedValue(undefined);
      const database = {
        select: () => ({
          from: () => ({
            leftJoin: () => ({
              where: () => ({
                limit: async () => [
                  {
                    id: 'run-id',
                    jobId: null,
                    status: 'running',
                    startedAt: new Date(Date.now() - 90 * 60_000),
                    createdAt: new Date(),
                    location: null,
                    callbackHeartbeatAt: heartbeatAt,
                    callbackFinishedAt: finishedAt,
                    callbackRevokedAt: null,
                  },
                ],
              }),
            }),
          }),
        }),
        transaction,
      };
      const hasActiveExecution = jest.fn().mockResolvedValue(podActive);
      const service = new StalledJobHandlerService(
        { db: database } as never,
        { get: jest.fn() } as never,
        { hasActiveExecution } as never,
      );
      const state = service as unknown as {
        redisClient: object;
        isBullMqJobActive: () => Promise<boolean>;
        checkAndHandleStalledJobs: () => Promise<void>;
      };
      state.redisClient = {};
      const queueActive = jest
        .spyOn(state, 'isBullMqJobActive')
        .mockResolvedValue(true);
      await state.checkAndHandleStalledJobs();
      expect(transaction).toHaveBeenCalledTimes(recover ? 1 : 0);
      expect(hasActiveExecution).toHaveBeenCalledTimes(checkPod ? 1 : 0);
      if (heartbeatAt) expect(queueActive).not.toHaveBeenCalled();
      else expect(queueActive).toHaveBeenCalled();
    },
  );

  it('awaits BullMQ queue shutdown before disconnecting Redis', async () => {
    const service = new StalledJobHandlerService(
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
    const lifecycle: string[] = [];
    const queue = {
      close: jest.fn(async () => {
        lifecycle.push('queue-close-start');
        await Promise.resolve();
        lifecycle.push('queue-close-finished');
      }),
    };
    const redisClient = {
      disconnect: jest.fn(() => lifecycle.push('redis-disconnect')),
    };
    (service as any).queues.set('execution', queue);
    (service as any).redisClient = redisClient;

    await service.onModuleDestroy();

    expect(queue.close).toHaveBeenCalledTimes(1);
    expect(redisClient.disconnect).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual([
      'queue-close-start',
      'queue-close-finished',
      'redis-disconnect',
    ]);
  });
  it('does not fail a run whose BullMQ job is paused', async () => {
    const service = new StalledJobHandlerService(
      {} as never,
      { get: jest.fn() } as never,
      {} as never,
    );
    const state = service as unknown as {
      redisClient: object;
      queues: Map<string, object>;
      isBullMqJobActive(
        runId: string,
        location: string | null,
      ): Promise<boolean>;
    };
    state.redisClient = {};
    state.queues.set('playwright-global', {
      getJob: async () => ({ getState: async () => 'waiting' }),
    });
    expect(await state.isBullMqJobActive('paused-run', null)).toBe(true);
  });

  it.each([
    ['orphaned', false, true],
    ['still in BullMQ', true, false],
  ])(
    'sweeps a plain queued run past the threshold: %s',
    async (_name, queueActive, recover) => {
      const transaction = jest.fn().mockResolvedValue(undefined);
      const database = {
        select: () => ({
          from: () => ({
            leftJoin: () => ({
              where: () => ({
                limit: async () => [
                  {
                    id: 'queued-run',
                    jobId: null,
                    status: 'queued',
                    errorDetails: null,
                    startedAt: null,
                    createdAt: new Date(Date.now() - 31 * 60_000),
                    location: null,
                    callbackHeartbeatAt: null,
                    callbackFinishedAt: null,
                    callbackRevokedAt: null,
                  },
                ],
              }),
            }),
          }),
        }),
        transaction,
      };
      const service = new StalledJobHandlerService(
        { db: database } as never,
        { get: jest.fn() } as never,
        { hasActiveExecution: jest.fn().mockResolvedValue(false) } as never,
      );
      const state = service as unknown as {
        redisClient: object;
        isBullMqJobActive: () => Promise<boolean>;
        checkAndHandleStalledJobs: () => Promise<void>;
      };
      state.redisClient = {};
      jest.spyOn(state, 'isBullMqJobActive').mockResolvedValue(queueActive);
      await state.checkAndHandleStalledJobs();
      expect(transaction).toHaveBeenCalledTimes(recover ? 1 : 0);
    },
  );

  it.each([
    ['the newest run', ['error', 'passed', 'failed'], 'error'],
    ['a still-active run', ['error', 'running', 'failed'], 'running'],
  ])(
    'sets a recovered job from %s, not its whole history',
    async (_name, newestFirst, expected) => {
      const database = {
        select: () => ({
          from: () => ({
            leftJoin: () => ({
              where: () => ({
                limit: async () => [
                  {
                    id: 'run-id',
                    jobId: 'job-id',
                    status: 'running',
                    startedAt: new Date(Date.now() - 90 * 60_000),
                    createdAt: new Date(),
                    location: null,
                    callbackHeartbeatAt: new Date(Date.now() - 180_000),
                    callbackFinishedAt: null,
                    callbackRevokedAt: null,
                  },
                ],
              }),
            }),
          }),
        }),
        transaction: jest.fn().mockResolvedValue(undefined),
        query: {
          runs: {
            findMany: jest.fn().mockResolvedValue(
              newestFirst.map((status, index) => ({
                id: `r${index}`,
                jobId: 'job-id',
                status,
              })),
            ),
          },
        },
      };
      const updateJobStatus = jest.fn().mockResolvedValue(undefined);
      const service = new StalledJobHandlerService(
        { db: database, updateJobStatus } as never,
        { get: jest.fn() } as never,
        { hasActiveExecution: jest.fn().mockResolvedValue(false) } as never,
      );
      const state = service as unknown as {
        redisClient: object;
        isBullMqJobActive: () => Promise<boolean>;
        checkAndHandleStalledJobs: () => Promise<void>;
      };
      state.redisClient = {};
      jest.spyOn(state, 'isBullMqJobActive').mockResolvedValue(false);
      await state.checkAndHandleStalledJobs();
      expect(updateJobStatus).toHaveBeenCalledWith('job-id', [expected]);
    },
  );
});
