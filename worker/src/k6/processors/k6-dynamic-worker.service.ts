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
import { buildRedisOptions } from '../../common/redis/redis-options';
import { K6ExecutionTask } from '../services/k6-execution.service';
import { K6ExecutionProcessor } from './k6-execution.processor';
import { K6_QUEUE, k6QueueName } from '../k6.constants';
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
  private readonly workers = new Map<string, Worker>();
  private readonly activeQueueNames = new Set<string>();
  private connection: Redis | null = null;
  private subscriber: Redis | null = null;
  private workerLocation = 'local';
  private shuttingDown = false;
  private refreshPromise: Promise<void> = Promise.resolve();
  private discoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;

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
    const enabledQueues = await this.getRegionalQueueNames(this.workerLocation);
    const queueNames =
      enabledQueues ??
      (this.workerLocation === 'local'
        ? await this.discoverRegionalQueues('k6-')
        : [k6QueueName(this.workerLocation)]);
    if (enabledQueues === null && queueNames.length === 0) {
      queueNames.push(k6QueueName('local'));
    }

    this.heartbeatService.addQueues([K6_QUEUE]);
    for (const queueName of queueNames) {
      this.createWorkerForQueue(queueName);
    }

    this.subscribeToQueueRefresh();
    this.scheduleDiscoveryRetry();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    this.heartbeatService.removeQueues(Array.from(this.activeQueueNames));
    if (this.discoveryRetryTimer) {
      clearTimeout(this.discoveryRetryTimer);
      this.discoveryRetryTimer = null;
    }

    if (this.subscriber) {
      // Pub/sub has no jobs to drain; Redis commands can wait forever offline.
      this.subscriber.disconnect();
      this.subscriber = null;
    }

    await this.refreshPromise;

    const closePromises = Array.from(this.workers.values()).map((w) =>
      w.close(),
    );
    await Promise.allSettled(closePromises);
    this.workers.clear();
    this.activeQueueNames.clear();

    if (this.connection) {
      await this.connection.quit().catch(() => {});
      this.connection = null;
    }
  }

  /**
   * Create a BullMQ Worker for a single regional queue and register event handlers.
   */
  private createWorkerForQueue(queueName: string): void {
    if (
      this.shuttingDown ||
      !this.connection ||
      this.activeQueueNames.has(queueName)
    )
      return;

    const worker = new Worker(
      queueName,
      async (job: Job<K6ExecutionTask>) => this.processJob(job),
      {
        // BullMQ creates and closes its own blocking connection. The service
        // owns this shared command connection and closes it during shutdown.
        connection: this.connection,
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

    this.workers.set(queueName, worker);
    this.activeQueueNames.add(queueName);
    this.heartbeatService.addQueues([queueName]);
    this.logger.log(`Registered dynamic K6 worker for queue: ${queueName}`);
  }

  private async removeWorkerForQueue(queueName: string): Promise<void> {
    const worker = this.workers.get(queueName);
    if (!worker) return;

    this.heartbeatService.removeQueues([queueName]);
    try {
      await worker.close();
    } catch (error) {
      this.logger.warn(
        `Failed to close dynamic K6 worker for ${queueName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    this.workers.delete(queueName);
    this.activeQueueNames.delete(queueName);
    this.logger.log(`Removed dynamic K6 worker for queue: ${queueName}`);
  }

  /**
   * Subscribe to Redis Pub/Sub channel for queue-refresh events.
   * When the App adds/removes locations, it publishes to this channel
   * so workers can discover and subscribe to newly created queues.
   */
  private subscribeToQueueRefresh(): void {
    if (!this.connection) return;

    const subscriber = this.connection.duplicate();
    this.subscriber = subscriber;
    const subscribe = () => {
      if (this.shuttingDown) return;
      subscriber
        .subscribe('supercheck:queue-refresh')
        .then(() => this.handleQueueRefresh())
        .catch((err) => {
          this.logger.error(
            `Failed to refresh queue subscription: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    };
    // Reconcile after subscription acknowledgement to recover missed messages.
    subscriber.on('ready', subscribe);
    if (subscriber.status === 'ready') subscribe();
    subscriber.on('error', (err: Error) => {
      this.logger.warn(`Queue-refresh Redis error: ${err.message}`);
    });

    this.subscriber.on('message', (_channel: string, message: string) => {
      this.handleQueueRefresh(message).catch((err) => {
        this.logger.error(
          `Error handling queue refresh: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
  }

  /** Reconcile enabled queues in notification order. */
  private handleQueueRefresh(message?: string): Promise<void> {
    const refresh = this.refreshPromise.then(() => this.refreshQueues(message));
    // A failed refresh must not block subsequent notifications.
    this.refreshPromise = refresh.catch(() => {});
    return refresh;
  }

  private async refreshQueues(message?: string): Promise<void> {
    if (this.shuttingDown) return;
    // The DB wins over delayed snapshots; messages remain useful during an outage.
    let newQueues = await this.getRegionalQueueNames(this.workerLocation);
    if (newQueues === null && message) {
      try {
        const parsed = JSON.parse(message) as { locationCodes?: string[] };
        if (
          Array.isArray(parsed?.locationCodes) &&
          parsed.locationCodes.every((code) => typeof code === 'string')
        ) {
          newQueues = parsed.locationCodes
            .filter(
              (code) =>
                this.workerLocation === 'local' ||
                code.toLowerCase() === this.workerLocation,
            )
            .map((code) => k6QueueName(code))
            .filter((name) => name !== K6_QUEUE);
        }
      } catch {
        // An unreadable message cannot replace the last known queue set.
      }
    }
    if (this.shuttingDown || newQueues === null) return;
    const targetQueues = new Set(newQueues);
    let added = 0;
    for (const queueName of newQueues) {
      if (!this.activeQueueNames.has(queueName)) {
        this.createWorkerForQueue(queueName);
        added++;
      }
    }
    const removedQueues = Array.from(this.activeQueueNames).filter(
      (queueName) => !targetQueues.has(queueName),
    );
    if (removedQueues.length > 0) {
      await Promise.allSettled(
        removedQueues.map((queueName) => this.removeWorkerForQueue(queueName)),
      );
    }
    if (added > 0) {
      this.logger.log(`Queue refresh: added ${added} new K6 regional queue(s)`);
    }
    if (removedQueues.length > 0) {
      this.logger.log(
        `Queue refresh: removed ${removedQueues.length} stale K6 regional queue(s)`,
      );
    }
  }

  /** Reconcile periodically so DB outages and lost notifications recover. */
  private scheduleDiscoveryRetry(): void {
    let delay = 30_000;
    const attempt = () => {
      this.discoveryRetryTimer = null;
      if (this.shuttingDown) return;
      this.handleQueueRefresh()
        .catch((err) => {
          this.logger.warn(
            `Queue discovery failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => {
          if (this.shuttingDown) return;
          delay = Math.min(delay * 2, 5 * 60_000);
          this.discoveryRetryTimer = setTimeout(attempt, delay);
        });
    };
    this.discoveryRetryTimer = setTimeout(attempt, delay);
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
  private async getRegionalQueueNames(
    location: string,
  ): Promise<string[] | null> {
    const dbCodes = await this.fetchEnabledLocationCodes();
    if (dbCodes === null) return null;
    if (location === 'local') {
      return dbCodes
        .map((code) => k6QueueName(code))
        .filter((name) => name !== K6_QUEUE);
    }
    return dbCodes.some((code) => code.toLowerCase() === location)
      ? [k6QueueName(location)]
      : [];
  }

  private async fetchEnabledLocationCodes(): Promise<string[] | null> {
    try {
      const rows = await this.dbService.db.execute(
        sql`SELECT code FROM locations WHERE is_enabled = true`,
      );
      return (rows as unknown as Array<{ code: string }>).map((r) => r.code);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch location codes from DB: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
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
    return new Redis(buildRedisOptions(this.configService));
  }
}
