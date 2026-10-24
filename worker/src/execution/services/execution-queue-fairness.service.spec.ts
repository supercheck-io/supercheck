import { ExecutionQueueFairnessService } from './execution-queue-fairness.service';

const queues: Array<{ name: string; close: jest.Mock }> = [];
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => {
    const queue = { name, close: jest.fn().mockResolvedValue(undefined) };
    queues.push(queue);
    return queue;
  }),
}));

type Job = {
  timestamp: number;
  data: { _executionTier?: string };
  getState: jest.Mock;
  changePriority: jest.Mock;
};
const job = (overrides: Partial<Job> = {}): Job => ({
  timestamp: 0,
  data: { _executionTier: 'trial' },
  getState: jest.fn().mockResolvedValue('prioritized'),
  changePriority: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

function setup() {
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    eval: jest.fn().mockResolvedValue(1),
    zrangebyscore: jest.fn().mockResolvedValue([]),
    scan: jest.fn().mockResolvedValue(['0', []]),
  };
  const jobs = new Map<string, Job>();
  const queue = {
    qualifiedName: 'bull:k6-eu',
    toKey: (name: string) => `bull:k6-eu:${name}`,
    getJob: jest.fn(async (id: string) => jobs.get(id)),
  };
  const service = new ExecutionQueueFairnessService({
    getClient: () => redis,
  } as never);
  return { redis, jobs, queue, service };
}

beforeEach(() => {
  queues.length = 0;
});
const NOW = 1_000_000;

describe('promote', () => {
  it('does nothing when no limited job is waiting', async () => {
    const { service, queue, redis } = setup();
    await service.promote(queue as never, NOW);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it.each([
    ['a paid job', { data: { _executionTier: 'paid' }, timestamp: 0 }],
    ['a trial job younger than a minute', { timestamp: NOW - 59_999 }],
  ])('leaves %s in its normal priority', async (_label, overrides) => {
    const { service, queue, redis, jobs } = setup();
    const candidate = job(overrides);
    jobs.set('a', candidate);
    redis.zrangebyscore.mockResolvedValue(['a']);
    await service.promote(queue as never, NOW);
    expect(redis.set).not.toHaveBeenCalled();
    expect(candidate.changePriority).not.toHaveBeenCalled();
  });

  it('ignores a candidate that disappeared', async () => {
    const { service, queue, redis } = setup();
    redis.zrangebyscore.mockResolvedValue(['gone']);
    await service.promote(queue as never, NOW);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('promotes the oldest eligible trial job once, holding a single ticket', async () => {
    const { service, queue, redis, jobs } = setup();
    const candidate = job({ timestamp: NOW - 60_000 });
    jobs.set('a', candidate);
    redis.zrangebyscore.mockResolvedValue(['a']);
    await service.promote(queue as never, NOW);
    expect(redis.zrangebyscore).toHaveBeenCalledWith(
      'bull:k6-eu:prioritized',
      2 ** 32,
      2 * 2 ** 32 - 1,
      'LIMIT',
      0,
      1,
    );
    expect(redis.set).toHaveBeenCalledWith(
      'supercheck:execution-fairness:bull:k6-eu',
      'a',
      'EX',
      900,
      'NX',
    );
    expect(candidate.changePriority).toHaveBeenCalledWith({ priority: 0 });
  });

  it('does not promote when another worker already holds the ticket', async () => {
    const { service, queue, redis, jobs } = setup();
    const candidate = job({ timestamp: 0 });
    jobs.set('a', candidate);
    redis.zrangebyscore.mockResolvedValue(['a']);
    redis.set.mockResolvedValue(null);
    await service.promote(queue as never, NOW);
    expect(candidate.changePriority).not.toHaveBeenCalled();
  });

  it('keeps one promoted job in flight and finishes promoting it if still prioritized', async () => {
    const { service, queue, redis, jobs } = setup();
    redis.get.mockResolvedValue('held');
    const held = job();
    jobs.set('held', held);
    await service.promote(queue as never, NOW);
    expect(held.changePriority).toHaveBeenCalledWith({ priority: 0 });
    expect(redis.zrangebyscore).not.toHaveBeenCalled();
  });

  it('waits while the promoted job is running', async () => {
    const { service, queue, redis, jobs } = setup();
    redis.get.mockResolvedValue('held');
    const held = job({ getState: jest.fn().mockResolvedValue('active') });
    jobs.set('held', held);
    await service.promote(queue as never, NOW);
    expect(held.changePriority).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(redis.zrangebyscore).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed', 'missing'])(
    'releases the ticket compare-and-delete when the promoted job is %s',
    async (state) => {
      const { service, queue, redis, jobs } = setup();
      redis.get.mockResolvedValue('held');
      if (state !== 'missing')
        jobs.set('held', job({ getState: jest.fn().mockResolvedValue(state) }));
      await service.promote(queue as never, NOW);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('GET',KEYS[1]) == ARGV[1]"),
        1,
        'supercheck:execution-fairness:bull:k6-eu',
        'held',
      );
      expect(redis.zrangebyscore).toHaveBeenCalled();
    },
  );
});

describe('lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('tracks the standard queues plus discovered per-org k6 queues without duplicating them', async () => {
    const { service, redis } = setup();
    redis.scan.mockResolvedValue(['7', ['bull:k6-eu:meta', 'bull:k6-us:meta']]);
    await service['tick']();
    await service['tick']();
    const names = queues.map((queue) => queue.name);
    expect(names).toEqual(expect.arrayContaining(['k6-eu', 'k6-us']));
    expect(new Set(names).size).toBe(names.length);
    expect(service['cursor']).toBe('7');
  });

  it('never overlaps ticks and survives Redis errors', async () => {
    const { service, redis } = setup();
    redis.scan.mockRejectedValue(new Error('redis down'));
    const error = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    await service['tick']();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('redis down'));
    expect(service['busy']).toBe(false);
    service['busy'] = true;
    redis.scan.mockClear();
    await service['tick']();
    expect(redis.scan).not.toHaveBeenCalled();
  });

  it('polls on an unref timer and releases everything on shutdown', async () => {
    const { service, redis } = setup();
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(5000);
    expect(redis.scan).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
    expect(queues.every((queue) => queue.close.mock.calls.length === 1)).toBe(
      true,
    );
    redis.scan.mockClear();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(redis.scan).not.toHaveBeenCalled();
  });
});
