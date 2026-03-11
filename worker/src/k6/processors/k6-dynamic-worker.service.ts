import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { K6ExecutionTask } from '../services/k6-execution.service';
import { K6ExecutionProcessor } from './k6-execution.processor';
import { K6_QUEUE, k6QueueName, REGIONS } from '../k6.constants';
import { HeartbeatService } from '../../common/heartbeat/heartbeat.service';
import { DbService } from '../../db/db.service';
import { sql } from 'drizzle-orm';

/**
 * Dynamically creates BullMQ Workers for regional K6 queues.
 *
 * The NestJS @Processor decorator binds a processor to a SINGLE queue at compile time.
 * For dynamic locations (where queue names come from the database), we create BullMQ
 * Workers directly. Each Worker delegates to K6ExecutionProcessor's handleProcess logic.
 *
 * K6ExecutionProcessor still handles the global queue (k6-global) via @Processor.
 * This service handles the regional queues (k6-{locationCode}).
 */
@Injectable()
export class K6DynamicWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('K6DynamicWorkerService');
  private readonly workers: Worker[] = [];
  private readonly activeQueueNames = new Set<string>();
  private connection: Redis | null = null;
  private subscriber: Redis | null = null;
  private workerLocation = 'local';

  constructor(
    @Inject(forwardRef(() => K6ExecutionProcessor))
    private readonly k6Processor: K6ExecutionProcessor,
    private readonly configService: ConfigService,
    private readonly heartbeatService: HeartbeatService,
    private readonly dbService: DbService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.workerLocation = this.configService
      .get<string>('WORKER_LOCATION', 'local')
      .toLowerCase();

    // Create a dedicated Redis connection for workers
    this.connection = this.createRedisConnection();

    // Build list of regional queue names (excluding global — handled by @Processor)
    const queueNames = await this.getRegionalQueueNames(this.workerLocation);

    this.heartbeatService.addQueues([K6_QUEUE, ...queueNames]);

    if (queueNames.length === 0) {
      this.logger.log('No regional K6 queues to register');
    } else {
      for (const queueName of queueNames) {
        this.createWorkerForQueue(queueName);
      }
    }

    // Subscribe to queue-refresh notifications so we pick up newly added locations
    if (this.workerLocation === 'local') {
      this.subscribeToQueueRefresh();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber
        .unsubscribe('supercheck:queue-refresh')
        .catch(() => {});
      await this.subscriber.quit().catch(() => {});
      this.subscriber = null;
    }

    const closePromises = this.workers.map((w) => w.close());
    await Promise.allSettled(closePromises);
    this.workers.length = 0;

    if (this.connection) {
      await this.connection.quit().catch(() => {});
      this.connection = null;
    }
  }

  /**
   * Create a BullMQ Worker for a single regional queue and register event handlers.
   */
  private createWorkerForQueue(queueName: string): void {
    if (!this.connection || this.activeQueueNames.has(queueName)) return;

    const worker = new Worker(
      queueName,
      async (job: Job<K6ExecutionTask>) => this.processJob(job),
      {
        connection: this.connection.duplicate(),
        concurrency: 1,
        lockDuration: 70 * 60 * 1000,
        stalledInterval: 30000,
        maxStalledCount: 2,
      },
    );

    worker.on('completed', (job: Job, result: unknown) => {
      const res = result as
        | { timedOut?: boolean; success?: boolean }
        | undefined;
      const timedOut = Boolean(res?.timedOut);
      const status = timedOut
        ? 'timed out'
        : res?.success
          ? 'passed'
          : 'failed';
      this.logger.log(`[${queueName}] k6 job ${job.id} completed: ${status}`);
    });

    worker.on('failed', (job: Job | undefined, error: Error) => {
      this.logger.error(
        `[${queueName}] k6 job ${job?.id || 'unknown'} failed: ${error.message}`,
        error.stack,
      );
    });

    worker.on('error', (error: Error) => {
      this.logger.error(
        `[${queueName}] worker error: ${error.message}`,
        error.stack,
      );
    });

    this.workers.push(worker);
    this.activeQueueNames.add(queueName);
    this.logger.log(`Registered dynamic K6 worker for queue: ${queueName}`);
  }

  /**
   * Subscribe to Redis Pub/Sub channel for queue-refresh events.
   * When the App adds/removes locations, it publishes to this channel
   * so workers can discover and subscribe to newly created queues.
   */
  private subscribeToQueueRefresh(): void {
    if (!this.connection) return;

    this.subscriber = this.connection.duplicate();
    this.subscriber.subscribe('supercheck:queue-refresh').catch((err) => {
      this.logger.error(
        `Failed to subscribe to queue-refresh channel: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    this.subscriber.on('message', (_channel: string, message: string) => {
      this.handleQueueRefresh(message).catch((err) => {
        this.logger.error(
          `Error handling queue refresh: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
  }

  /**
   * Re-discover queues and create workers for any new ones.
   * Prefers location codes from the pub/sub message to construct queue names
   * deterministically — SCAN-based discovery may miss new queues whose
   * Redis :meta key hasn't been created yet.
   */
  private async handleQueueRefresh(message?: string): Promise<void> {
    let newQueues: string[];
    try {
      const parsed = message
        ? (JSON.parse(message) as { locationCodes?: string[] })
        : null;
      if (
        Array.isArray(parsed?.locationCodes) &&
        parsed.locationCodes.length > 0
      ) {
        newQueues = parsed.locationCodes
          .map((code: string) => k6QueueName(code))
          .filter((q: string) => q !== K6_QUEUE);
      } else {
        newQueues = await this.getRegionalQueueNames(this.workerLocation);
      }
    } catch {
      newQueues = await this.getRegionalQueueNames(this.workerLocation);
    }
    let added = 0;
    for (const queueName of newQueues) {
      if (!this.activeQueueNames.has(queueName)) {
        this.createWorkerForQueue(queueName);
        this.heartbeatService.addQueues([queueName]);
        added++;
      }
    }
    if (added > 0) {
      this.logger.log(`Queue refresh: added ${added} new K6 regional queue(s)`);
    }
  }

  /**
   * Delegate to K6ExecutionProcessor.handleProcess() which handles the full lifecycle:
   * cancellation checks, billing blocks, run status updates, k6_performance_runs insert,
   * usage tracking, job status updates, and notifications.
   */
  private async processJob(
    job: Job<K6ExecutionTask>,
  ): Promise<{ success: boolean; timedOut?: boolean }> {
    return this.k6Processor.handleProcess(job);
  }

  /**
   * Get regional queue names based on worker location.
   * Excludes the global queue (handled by K6ExecutionProcessor via @Processor).
   */
  private async getRegionalQueueNames(location: string): Promise<string[]> {
    if (location === 'local') {
      const queueNames = new Set<string>();

      // 1. Discover from Redis metadata keys (existing queues that have had jobs)
      const discovered = await this.discoverRegionalQueues('k6-');
      for (const q of discovered) queueNames.add(q);

      // 2. Discover from DB — covers locations enabled in DB but not yet in Redis
      const dbCodes = await this.fetchEnabledLocationCodes();
      for (const code of dbCodes) {
        const name = k6QueueName(code);
        // Exclude global queue (handled by @Processor)
        if (name !== K6_QUEUE) {
          queueNames.add(name);
        }
      }

      // 3. Legacy fallback if nothing discovered
      if (queueNames.size === 0) {
        queueNames.add(k6QueueName('local'));
        for (const r of REGIONS) queueNames.add(k6QueueName(r));
      }

      return Array.from(queueNames);
    }

    // Production: just this worker's regional queue
    return [k6QueueName(location)];
  }

  private async fetchEnabledLocationCodes(): Promise<string[]> {
    try {
      const rows = await this.dbService.db.execute(
        sql`SELECT code FROM locations WHERE is_enabled = true`,
      );
      return (rows as unknown as Array<{ code: string }>).map((r) => r.code);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch location codes from DB: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async discoverRegionalQueues(prefix: string): Promise<string[]> {
    if (!this.connection) {
      return [];
    }

    try {
      const queueNames = new Set<string>();
      let cursor = '0';

      do {
        const [nextCursor, keys] = await this.connection.scan(
          cursor,
          'MATCH',
          `bull:${prefix}*:meta`,
          'COUNT',
          '100',
        );

        cursor = nextCursor;

        for (const key of keys) {
          const match = /^bull:(.+):meta$/.exec(key);
          const queueName = match?.[1];

          // Exclude global queue (handled by @Processor) and scheduler queues (processed by the App)
          if (
            !queueName ||
            queueName === K6_QUEUE ||
            queueName.endsWith('-scheduler')
          ) {
            continue;
          }

          queueNames.add(queueName);
        }
      } while (cursor !== '0');

      return Array.from(queueNames).sort();
    } catch (error) {
      this.logger.error(
        `Failed to discover regional queues with prefix '${prefix}': ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private createRedisConnection(): Redis {
    const tlsEnabled =
      this.configService.get<string>('REDIS_TLS_ENABLED', 'false') === 'true';
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const username = this.configService.get<string>('REDIS_USERNAME');

    return new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: password || undefined,
      username: username || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      ...(tlsEnabled && {
        tls: {
          rejectUnauthorized:
            this.configService.get<string>(
              'REDIS_TLS_REJECT_UNAUTHORIZED',
              'true',
            ) !== 'false',
        },
      }),
    });
  }
}
