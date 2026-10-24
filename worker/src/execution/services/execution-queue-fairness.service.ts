import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from './redis.service';
import { PLAYWRIGHT_QUEUE } from '../constants';
import { K6_QUEUE } from '../../k6/k6.constants';

// A promoted job that stalls (for example behind a busy organization slot) must
// not pin the queue's single promotion ticket indefinitely.
const TICKET_TTL_SECONDS = 15 * 60;

type ExecutionQueueData = { _executionTier?: string };

@Injectable()
export class ExecutionQueueFairnessService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ExecutionQueueFairnessService.name);
  private readonly queues = new Map<string, Queue<ExecutionQueueData>>();
  private timer?: ReturnType<typeof setInterval>;
  private cursor = '0';
  private busy = false;
  constructor(private readonly redisService: RedisService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, 5000);
    this.timer.unref();
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const redis = this.redisService.getClient();
      const [cursor, keys] = await redis.scan(
        this.cursor,
        'MATCH',
        'bull:k6-*:meta',
        'COUNT',
        100,
      );
      this.cursor = cursor;
      const names = [
        PLAYWRIGHT_QUEUE,
        K6_QUEUE,
        ...keys.map((key) => key.slice(5, -5)),
      ];
      for (const name of names)
        if (!this.queues.has(name))
          this.queues.set(name, new Queue(name, { connection: redis }));
      for (const queue of this.queues.values()) await this.promote(queue);
    } catch (error) {
      this.logger.error(
        `Unable to advance execution queue fairness: ${String(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }

  async promote(
    queue: Queue<ExecutionQueueData>,
    now = Date.now(),
  ): Promise<void> {
    const redis = this.redisService.getClient();
    const ticket = `supercheck:execution-fairness:${queue.qualifiedName}`;
    const current = await redis.get(ticket);
    if (current) {
      const job = await queue.getJob(current);
      const state = job ? await job.getState() : 'unknown';
      if (job && !['completed', 'failed', 'unknown'].includes(state)) {
        if (state === 'prioritized') await job.changePriority({ priority: 0 });
        return;
      }
      await redis.eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
        1,
        ticket,
        current,
      );
    }
    // BullMQ stores priority in the high 32 bits; rank one is the limited FIFO.
    const [id] = await redis.zrangebyscore(
      queue.toKey('prioritized'),
      2 ** 32,
      2 * 2 ** 32 - 1,
      'LIMIT',
      0,
      1,
    );
    if (!id) return;
    const job = await queue.getJob(id);
    if (
      !job ||
      job.data._executionTier !== 'trial' ||
      now - job.timestamp < 60000
    )
      return;
    if (await redis.set(ticket, id, 'EX', TICKET_TTL_SECONDS, 'NX'))
      await job.changePriority({ priority: 0 });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled(
      Array.from(this.queues.values()).map((queue) => queue.close()),
    );
  }
}
