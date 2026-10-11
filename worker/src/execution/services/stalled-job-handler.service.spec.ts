import { StalledJobHandlerService } from './stalled-job-handler.service';

describe('StalledJobHandlerService', () => {
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
});
