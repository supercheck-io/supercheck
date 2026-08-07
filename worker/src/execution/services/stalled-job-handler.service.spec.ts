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
});
