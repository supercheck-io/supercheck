import { RedisService } from './redis.service';

describe('BullMQ cleanup expiry repair', () => {
  it('persists durable data and leaves BullMQ leases untouched', async () => {
    const prefix = 'bull:playwright-global:';
    const durable = [
      'id',
      'paused',
      'marker',
      'run-1',
      'run-1:logs',
      'metrics:completed:data',
    ];
    const leases = ['run-1:lock', 'limiter', 'stalled-check', 'de:request-1'];
    const redis = {
      scan: jest
        .fn()
        .mockResolvedValue([
          '0',
          [...durable, ...leases].map((key) => prefix + key),
        ]),
      type: jest.fn(async (key: string) =>
        key === prefix + 'run-1' ? 'hash' : 'string',
      ),
      persist: jest.fn().mockResolvedValue(1),
      expire: jest.fn(),
    };
    Object.assign(redis, {
      pipeline: jest.fn(() => {
        const results: Array<Promise<[null, unknown]>> = [];
        return {
          type: (key: string) =>
            results.push(redis.type(key).then((type) => [null, type])),
          persist: (key: string) =>
            results.push(redis.persist(key).then((value) => [null, value])),
          exec: () => Promise.all(results),
        };
      }),
    });
    const service = Object.assign(Object.create(RedisService.prototype), {
      redisClient: redis,
      logger: { debug: jest.fn(), error: jest.fn() },
    }) as { cleanupOrphanedKeys(queueName: string): Promise<void> };

    await service.cleanupOrphanedKeys('playwright-global');

    expect(redis.persist.mock.calls.map(([key]) => key).sort()).toEqual(
      durable.map((key) => prefix + key).sort(),
    );
    expect(redis.expire).not.toHaveBeenCalled();
  });
});
