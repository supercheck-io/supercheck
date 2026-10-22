import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { ExecutionQueueFairnessService } from '../src/execution/services/execution-queue-fairness.service';

let redis: Redis;
let fairness: ExecutionQueueFairnessService;
beforeAll(() => {
  if (!process.env.TEST_REDIS_SOCKET && !process.env.TEST_REDIS_URL)
    throw new Error('TEST_REDIS_SOCKET or TEST_REDIS_URL required');
  redis = process.env.TEST_REDIS_URL
    ? new Redis(process.env.TEST_REDIS_URL, { maxRetriesPerRequest: null })
    : new Redis({
        path: process.env.TEST_REDIS_SOCKET,
        maxRetriesPerRequest: null,
      });
  fairness = new ExecutionQueueFairnessService({
    getClient: () => redis,
  } as never);
});
afterAll(async () => {
  await redis?.quit();
});
it.each([1, 20, 200])(
  'bounds a standard run behind at most one aged limited run among %i queued',
  async (count) => {
    const name = `fair-${randomUUID()}`;
    const queue = new Queue(name, { connection: redis });
    const worker = new Worker(name, undefined, {
      connection: redis,
      autorun: false,
    });
    try {
      await queue.addBulk(
        Array.from({ length: count }, (_, index) => ({
          name: 'run',
          data: { _executionTier: 'trial' },
          opts: {
            jobId: `limited-${index}`,
            priority: 1,
            timestamp: Date.now() - 61000,
          },
        })),
      );
      await fairness.promote(queue);
      await fairness.promote(queue);
      expect(await queue.getWaitingCount()).toBe(1);
      await queue.add(
        'run',
        { _executionTier: 'paid' },
        { jobId: 'standard', priority: 0 },
      );
      const order: string[] = [];
      for (let index = 0; index < 2; index++) {
        const token = randomUUID();
        const job = await worker.getNextJob(token);
        expect(job).toBeDefined();
        order.push(job.id!);
        await job.moveToCompleted({}, token, false);
      }
      expect(order).toEqual(['limited-0', 'standard']);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  },
);
it('lets an aged run precede future arrivals while preserving earlier standard FIFO', async () => {
  const name = `fair-${randomUUID()}`;
  const queue = new Queue(name, { connection: redis });
  const worker = new Worker(name, undefined, {
    connection: redis,
    autorun: false,
  });
  try {
    await queue.add(
      'run',
      { _executionTier: 'paid' },
      { jobId: 'earlier', priority: 0 },
    );
    await queue.add(
      'run',
      { _executionTier: 'trial' },
      { jobId: 'aged', priority: 1, timestamp: Date.now() - 61000 },
    );
    await fairness.promote(queue);
    await queue.add(
      'run',
      { _executionTier: 'paid' },
      { jobId: 'later', priority: 0 },
    );
    const order: string[] = [];
    for (let index = 0; index < 3; index++) {
      const token = randomUUID();
      const job = await worker.getNextJob(token);
      order.push(job.id!);
      await job.moveToCompleted({}, token, false);
    }
    expect(order).toEqual(['earlier', 'aged', 'later']);
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
