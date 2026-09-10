import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { buildRedisOptions } from '../../common/redis/redis-options';
import { MonitorService } from '../monitor.service';
import { MonitorJobDataDto } from '../dto/monitor-job.dto';
import { MonitorExecutionResult } from '../types/monitor-result.type';
import {
  EXECUTE_MONITOR_JOB_NAME,
  monitorQueueName,
} from '../monitor.constants';
import { HeartbeatService } from '../../common/heartbeat/heartbeat.service';
import { DbService } from '../../db/db.service';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';

/**
 * Dynamically creates BullMQ Workers for regional monitor queues.
 *
 * Monitors MUST run in their specified location for accurate latency data.
 * There is no global/fallback queue for monitors.
 *
 * This service creates Workers at runtime, bypassing the compile-time constraint
 * of NestJS @Processor decorators. Each Worker delegates to MonitorService.
 */
@Injectable()
export class MonitorDynamicWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('MonitorDynamicWorkerService');
  private readonly workers = new Map<string, Worker>();
  private readonly activeQueueNames = new Set<string>();
  private connection: Redis | null = null;
  private subscriber: Redis | null = null;
  private workerLocation = 'local';
  private discoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly monitorService: MonitorService,
    private readonly configService: ConfigService,
    private readonly heartbeatService: HeartbeatService,
    private readonly dbService: DbService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.workerLocation = this.configService
      .get<string>('WORKER_LOCATION', 'local')
      .toLowerCase();

    this.connection = this.createRedisConnection();

    const queueNames = await this.getQueueNames(this.workerLocation);

    this.heartbeatService.addQueues(queueNames);

    if (queueNames.length === 0) {
      this.logger.log('No monitor queues to register');
    } else {
      for (const queueName of queueNames) {
        this.createWorkerForQueue(queueName);
      }
    }

    // Subscribe to queue-refresh notifications so we pick up newly added locations
    if (this.workerLocation === 'local') {
      this.subscribeToQueueRefresh();

      // Always schedule a discovery retry in local mode. Even if Redis SCAN
      // found some queues, the DB may have been temporarily unreachable,
      // leaving the worker with an incomplete subset. The retry is a no-op
      // when handleQueueRefresh() finds nothing new to add.
      this.scheduleDiscoveryRetry();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.discoveryRetryTimer) {
      clearTimeout(this.discoveryRetryTimer);
      this.discoveryRetryTimer = null;
    }

    if (this.subscriber) {
      await this.subscriber
        .unsubscribe('supercheck:queue-refresh')
        .catch(() => {});
      await this.subscriber.quit().catch(() => {});
      this.subscriber = null;
    }

    await Promise.allSettled(
      Array.from(this.workers.values()).map((w) => w.close()),
    );
    this.workers.clear();

    if (this.connection) {
      await this.connection.quit().catch(() => {});
      this.connection = null;
    }
  }

  /**
   * Create a BullMQ Worker for a single queue and register event handlers.
   */
  private createWorkerForQueue(queueName: string): void {
    if (!this.connection || this.activeQueueNames.has(queueName)) return;

    const worker = new Worker(
      queueName,
      async (job: Job<MonitorJobDataDto>) => this.processJob(job),
      {
        // BullMQ creates and closes its own blocking connection. The service
        // owns this shared command connection and closes it during shutdown.
        connection: this.connection,
        concurrency: 1,
        lockDuration: 5 * 60 * 1000,
        stalledInterval: 30000,
        maxStalledCount: 2,
      },
    );

    worker.on('completed', (job: Job<MonitorJobDataDto>, result: unknown) => {
      const results = result as MonitorExecutionResult[] | undefined;
      if (job.data?.executionLocation) return; // Distributed mode saves individually
      if (results && results.length > 0) {
        this.monitorService.saveMonitorResults(results).catch((error) => {
          this.logger.error(
            `Failed to save monitor results: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    });

    worker.on('failed', (job: Job | undefined, error: Error) => {
      this.logger.error(
        `[${queueName}] monitor job ${job?.id || 'unknown'} failed: ${error.message}`,
        error.stack,
      );

      // When the job has exhausted all retries and is part of a distributed
      // execution group, generate an error MonitorResult so the aggregation
      // gate (Redis SCARD vs expectedLocations.length) can still complete.
      // Without this, one failed location would stall aggregation for the
      // entire execution cycle.
      if (job?.data) {
        this.handleFinalJobFailure(job as Job<MonitorJobDataDto>, error).catch(
          (err) => {
            this.logger.error(
              `[${queueName}] failed to record error result for job ${job.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          },
        );
      }
    });

    worker.on('error', (error: Error) => {
      this.logger.error(
        `[${queueName}] worker error: ${error.message}`,
        error.stack,
      );
    });

    this.workers.set(queueName, worker);
    this.activeQueueNames.add(queueName);
    this.logger.log(
      `Registered dynamic monitor worker for queue: ${queueName}`,
    );
  }

  private async removeWorkerForQueue(queueName: string): Promise<void> {
    const worker = this.workers.get(queueName);
    if (!worker) return;

    try {
      await worker.close();
    } catch (error) {
      this.logger.warn(
        `Failed to close dynamic monitor worker for ${queueName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    this.workers.delete(queueName);
    this.activeQueueNames.delete(queueName);
    this.heartbeatService.removeQueues([queueName]);
    this.logger.log(`Removed dynamic monitor worker for queue: ${queueName}`);
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
      if (Array.isArray(parsed?.locationCodes)) {
        newQueues = parsed.locationCodes.map((code: string) =>
          monitorQueueName(code),
        );
      } else {
        newQueues = await this.getQueueNames(this.workerLocation);
      }
    } catch {
      newQueues = await this.getQueueNames(this.workerLocation);
    }
    const targetQueues = new Set(newQueues);
    let added = 0;
    for (const queueName of newQueues) {
      if (!this.activeQueueNames.has(queueName)) {
        this.createWorkerForQueue(queueName);
        this.heartbeatService.addQueues([queueName]);
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
      this.logger.log(`Queue refresh: added ${added} new monitor queue(s)`);
    }
    if (removedQueues.length > 0) {
      this.logger.log(
        `Queue refresh: removed ${removedQueues.length} stale monitor queue(s)`,
      );
    }
  }

  /**
   * Schedule a delayed re-discovery attempt with exponential backoff.
   * Covers transient DB/Redis failures during startup: the worker starts with
   * only the local fallback queue but should pick up the real location queues
   * once infrastructure recovers.
   *
   * Uses exponential backoff (30s, 60s, 120s, …) capped at 5 minutes.
   * Stops retrying once a refresh discovers new queues (the pub/sub
   * listener handles further changes). The timer is stored so it can
   * be cancelled in onModuleDestroy().
   */
  private scheduleDiscoveryRetry(): void {
    const BASE_DELAY_MS = 30_000;
    const MAX_DELAY_MS = 5 * 60_000; // 5 minutes cap
    const MAX_STABLE_RETRIES = 3; // stop after N consecutive no-growth attempts
    let retries = 0;
    let stableRetries = 0;

    const nextDelay = () =>
      Math.min(BASE_DELAY_MS * Math.pow(2, retries), MAX_DELAY_MS);

    const attempt = () => {
      retries++;
      const prevSize = this.activeQueueNames.size;
      this.logger.log(
        `Discovery retry ${retries}: re-scanning for regional monitor queues (active: ${this.activeQueueNames.size})…`,
      );
      this.handleQueueRefresh()
        .then(() => {
          const grew = this.activeQueueNames.size > prevSize;
          if (grew) {
            this.logger.log(
              `Discovery retry succeeded: now have ${this.activeQueueNames.size} monitor queue(s)`,
            );
            // Reset stable counter on growth — more queues may still appear
            stableRetries = 0;
            this.discoveryRetryTimer = setTimeout(attempt, nextDelay());
          } else {
            stableRetries++;
            if (stableRetries >= MAX_STABLE_RETRIES) {
              this.logger.log(
                `Discovery retry: queue set stable for ${stableRetries} consecutive checks. ` +
                  `Stopping retry loop (${this.activeQueueNames.size} monitor queue(s)). ` +
                  `Pub/sub listener will handle further changes.`,
              );
              this.discoveryRetryTimer = null;
              return;
            }
            this.discoveryRetryTimer = setTimeout(attempt, nextDelay());
          }
        })
        .catch(() => {
          this.discoveryRetryTimer = setTimeout(attempt, nextDelay());
        });
    };

    this.discoveryRetryTimer = setTimeout(attempt, BASE_DELAY_MS);
  }

  private async processJob(
    job: Job<MonitorJobDataDto>,
  ): Promise<MonitorExecutionResult[]> {
    if (job.name !== EXECUTE_MONITOR_JOB_NAME) {
      this.logger.warn(`Unknown job name: ${job.name}`);
      throw new Error(`Unknown job name: ${job.name}`);
    }

    const jobLocation = job.data.executionLocation;

    if (jobLocation) {
      const result = await this.monitorService.executeMonitor(
        job.data,
        jobLocation,
      );

      if (!result) return [];

      await this.monitorService.saveDistributedMonitorResult(result, {
        executionGroupId: job.data.executionGroupId,
        expectedLocations: job.data.expectedLocations,
      });

      return [result];
    }

    // Legacy/single queue mode
    return this.monitorService.executeMonitorWithLocations(job.data);
  }

  /**
   * Generate an error MonitorResult for a job that failed after all retries.
   * This ensures the distributed aggregation gate can still complete —
   * without it, the Redis SCARD never reaches expectedLocations.length
   * and the aggregation stalls until the TTL expires.
   *
   * If processJob() already persisted a real result (e.g. the probe
   * succeeded but saveDistributedMonitorResult threw during Redis
   * coordination), we skip writing a synthetic error to avoid
   * overwriting a valid result.
   */
  private async handleFinalJobFailure(
    job: Job<MonitorJobDataDto>,
    error: Error,
  ): Promise<void> {
    const {
      executionGroupId,
      executionLocation,
      expectedLocations,
      monitorId,
    } = job.data;

    if (!executionGroupId || !executionLocation) return;

    // Stalled recovery and unrecoverable errors can fail permanently before
    // attemptsMade reaches attempts. Never synthesize an error for a retry.
    if ((await job.getState()) !== 'failed') return;

    // Check whether a real result for this location + execution group
    // was already persisted by processJob() before it threw.
    const existing = await this.dbService.db.query.monitorResults.findFirst({
      where: and(
        eq(schema.monitorResults.monitorId, monitorId),
        eq(schema.monitorResults.executionGroupId, executionGroupId),
        eq(schema.monitorResults.location, executionLocation),
      ),
      columns: { id: true },
    });

    if (existing) {
      this.logger.log(
        `Skipping synthetic error for ${monitorId}/${executionLocation}: ` +
          `real result already persisted (executionGroupId=${executionGroupId})`,
      );
      return;
    }

    const errorResult: MonitorExecutionResult = {
      monitorId,
      location: executionLocation,
      status: 'error',
      checkedAt: new Date(),
      isUp: false,
      details: {
        errorMessage: `Worker execution failed after ${job.attemptsMade} attempt(s): ${error.message}`,
      },
    };

    await this.monitorService.saveDistributedMonitorResult(errorResult, {
      executionGroupId,
      expectedLocations,
    });
  }

  /**
   * Get queue names based on worker location.
   * No global queue for monitors — all are location-specific.
   */
  private async getQueueNames(location: string): Promise<string[]> {
    if (location === 'local') {
      const queueNames = new Set<string>();

      // 1. Discover from Redis metadata keys (existing queues that have had jobs)
      const discovered = await this.discoverQueues();
      for (const q of discovered) queueNames.add(q);

      // 2. Discover from DB — covers locations enabled in DB but not yet in Redis
      const dbCodes = await this.fetchEnabledLocationCodes();
      for (const code of dbCodes) queueNames.add(monitorQueueName(code));

      // 3. Fallback if nothing discovered from Redis or DB
      if (queueNames.size === 0) {
        queueNames.add(monitorQueueName('local'));
      }

      return Array.from(queueNames);
    }
    return [monitorQueueName(location)];
  }

  /**
   * Fetch enabled location codes directly from the DB.
   * Covers locations that exist in the database but have no Redis :meta key yet
   * (e.g. newly created locations that haven't had a job enqueued since last Redis flush).
   */
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

  private async discoverQueues(): Promise<string[]> {
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
          'bull:monitor-*:meta',
          'COUNT',
          '100',
        );

        cursor = nextCursor;

        for (const key of keys) {
          const match = /^bull:(.+):meta$/.exec(key);
          const queueName = match?.[1];

          // Exclude non-execution queues (monitor-scheduler is processed by the App, not workers)
          if (!queueName || queueName === 'monitor-scheduler') {
            continue;
          }

          queueNames.add(queueName);
        }
      } while (cursor !== '0');

      return Array.from(queueNames).sort();
    } catch (error) {
      this.logger.error(
        `Failed to discover monitor queues: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private createRedisConnection(): Redis {
    return new Redis(buildRedisOptions(this.configService));
  }
}
