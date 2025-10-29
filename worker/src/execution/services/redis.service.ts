import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, RedisOptions } from 'ioredis';
import { Queue, QueueEvents } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { JOB_EXECUTION_QUEUE, TEST_EXECUTION_QUEUE } from '../constants';
import { DbService } from './db.service';

// Constants for Redis TTL
const REDIS_JOB_TTL = 7 * 24 * 60 * 60; // 7 days for job data
const REDIS_EVENT_TTL = 24 * 60 * 60; // 24 hours for events/stats
const REDIS_METRICS_TTL = 48 * 60 * 60; // 48 hours for metrics data
const REDIS_CLEANUP_BATCH_SIZE = 100; // Process keys in smaller batches to reduce memory pressure

/**
 * Redis Service for application-wide Redis operations and Bull queue status management
 *
 * This service combines direct Redis operations with Bull queue event management,
 * providing a unified interface for Redis-related functionality. It handles:
 *
 * 1. Direct Redis client operations when needed
 * 2. Bull queue event monitoring for job and test status updates
 * 3. Database updates based on Bull queue events (completed, failed, etc.)
 * 4. Automated cleanup of Redis keys to prevent memory growth
 *
 * The service eliminates the need for separate Redis pub/sub channels by using
 * Bull's built-in event system with proper TTL for automatic cleanup.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private redisClient: Redis;
  private jobQueueEvents: QueueEvents;
  private testQueueEvents: QueueEvents;
  private jobQueueEventsConnection: Redis;
  private testQueueEventsConnection: Redis;
  private readonly redisOptions: RedisOptions;
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private configService: ConfigService,
    @InjectQueue(JOB_EXECUTION_QUEUE) private jobQueue: Queue,
    @InjectQueue(TEST_EXECUTION_QUEUE) private testQueue: Queue,
    private dbService: DbService,
  ) {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const username = this.configService.get<string>('REDIS_USERNAME');
    const tlsEnabled =
      this.configService.get<string>('REDIS_TLS_ENABLED', 'false') === 'true';

    this.redisOptions = {
      host,
      port,
      password: password || undefined,
      username,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (attempt: number) =>
        Math.min(1000 * Math.pow(2, attempt), 10000),
      tls: tlsEnabled
        ? {
            rejectUnauthorized:
              this.configService.get<string>(
                'REDIS_TLS_REJECT_UNAUTHORIZED',
                'true',
              ) !== 'false',
          }
        : undefined,
    };

    this.logger.log(`Initializing Redis connection to ${host}:${port}`);

    this.redisClient = new Redis(this.redisOptions);

    this.redisClient.on('error', (err) =>
      this.logger.error('Redis Error:', err),
    );
    this.redisClient.on('connect', () => this.logger.log('Redis Connected'));
    this.redisClient.on('ready', () => this.logger.log('Redis Ready'));

    // Initialize Queue Events listeners
    this.initializeQueueListeners();

    // Set up periodic cleanup for orphaned Redis keys
    this.setupRedisCleanup();
  }

  async onModuleInit() {
    try {
      await this.redisClient.ping();
      this.logger.log('Redis connection successful');

      // Run initial cleanup on startup
      await this.performRedisCleanup();
    } catch (error) {
      this.logger.error('Redis connection failed:', error);
    }
  }

  /**
   * Returns the Redis client for direct operations
   */
  getClient(): Redis {
    return this.redisClient;
  }

  /**
   * Health check method for Redis connection
   */
  async ping(): Promise<string> {
    return this.redisClient.ping();
  }

  /**
   * Health check method for queue accessibility
   */
  async getQueueHealth(queueName: string): Promise<boolean> {
    try {
      // Try to get basic queue info
      const key = `bull:${queueName}:waiting`;
      await this.redisClient.llen(key);
      return true;
    } catch (error) {
      this.logger.warn(`Queue health check failed for ${queueName}:`, error);
      return false;
    }
  }

  /**
   * Sets up listeners for Bull queue events for logging and monitoring
   * Database updates are handled by the job execution processor to avoid race conditions
   */
  private initializeQueueListeners() {
    // Set up QueueEvents for job queue
    this.jobQueueEventsConnection = new Redis(this.redisOptions);
    this.testQueueEventsConnection = new Redis(this.redisOptions);

    this.jobQueueEventsConnection.on('error', (error) =>
      this.logger.error('Job QueueEvents connection error:', error),
    );
    this.testQueueEventsConnection.on('error', (error) =>
      this.logger.error('Test QueueEvents connection error:', error),
    );

    this.jobQueueEvents = new QueueEvents(JOB_EXECUTION_QUEUE, {
      connection: this.jobQueueEventsConnection,
    });

    // Set up QueueEvents for test queue
    this.testQueueEvents = new QueueEvents(TEST_EXECUTION_QUEUE, {
      connection: this.testQueueEventsConnection,
    });

    // Job queue event listeners - only for logging and monitoring
    this.jobQueueEvents.on('waiting', ({ jobId }) => {
      this.logger.debug(`Job ${jobId} is waiting`);
    });

    this.jobQueueEvents.on('active', ({ jobId }) => {
      this.logger.debug(`Job ${jobId} is active`);
      // Database updates are handled by the job execution processor
    });

    this.jobQueueEvents.on('completed', ({ jobId }) => {
      this.logger.debug(`Job ${jobId} completed`);
      // Database updates are handled by the job execution processor
    });

    this.jobQueueEvents.on('failed', ({ jobId, failedReason }) => {
      this.logger.error(`Job ${jobId} failed: ${failedReason}`);
      // Database updates are handled by the job execution processor
    });

    // Test queue event listeners - only for logging and monitoring
    this.testQueueEvents.on('waiting', ({ jobId }) => {
      this.logger.debug(`Test ${jobId} is waiting`);
    });

    this.testQueueEvents.on('active', ({ jobId }) => {
      this.logger.debug(`Test ${jobId} is active`);
    });

    this.testQueueEvents.on('completed', ({ jobId }) => {
      this.logger.debug(`Test ${jobId} completed`);
    });

    this.testQueueEvents.on('failed', ({ jobId, failedReason }) => {
      this.logger.error(`Test ${jobId} failed: ${failedReason}`);
    });
  }

  /**
   * Sets up periodic cleanup of orphaned Redis keys to prevent unbounded growth
   */
  private setupRedisCleanup() {
    this.logger.log('Setting up periodic Redis cleanup task');

    // Schedule cleanup every 12 hours - more frequent than before
    this.cleanupInterval = setInterval(
      () => {
        this.performRedisCleanup().catch((error) => {
          this.logger.error('Error during scheduled Redis cleanup:', error);
        });
      },
      12 * 60 * 60 * 1000,
    ); // 12 hours
  }

  /**
   * Performs the actual Redis cleanup operations
   */
  private async performRedisCleanup(): Promise<void> {
    this.logger.log('Running periodic Redis cleanup for queue data');

    try {
      // 1. Clean up completed/failed jobs
      await this.jobQueue.clean(
        REDIS_JOB_TTL * 1000,
        REDIS_CLEANUP_BATCH_SIZE,
        'completed',
      );
      await this.jobQueue.clean(
        REDIS_JOB_TTL * 1000,
        REDIS_CLEANUP_BATCH_SIZE,
        'failed',
      );
      await this.testQueue.clean(
        REDIS_JOB_TTL * 1000,
        REDIS_CLEANUP_BATCH_SIZE,
        'completed',
      );
      await this.testQueue.clean(
        REDIS_JOB_TTL * 1000,
        REDIS_CLEANUP_BATCH_SIZE,
        'failed',
      );

      // 2. Trim event streams to reduce memory usage
      await this.jobQueue.trimEvents(1000);
      await this.testQueue.trimEvents(1000);

      // 3. Set TTL on orphaned keys
      await this.cleanupOrphanedKeys(JOB_EXECUTION_QUEUE);
      await this.cleanupOrphanedKeys(TEST_EXECUTION_QUEUE);

      this.logger.log('Redis cleanup completed successfully');
    } catch (error) {
      this.logger.error('Error during Redis cleanup operations:', error);
    }
  }

  /**
   * Cleans up orphaned Redis keys that might not have TTL set
   * Uses efficient SCAN pattern to reduce memory pressure
   */
  private async cleanupOrphanedKeys(queueName: string): Promise<void> {
    try {
      // Use scan instead of keys to reduce memory pressure
      let cursor = '0';
      let processedKeys = 0;

      do {
        const [nextCursor, keys] = await this.redisClient.scan(
          cursor,
          'MATCH',
          `bull:${queueName}:*`,
          'COUNT',
          '100',
        );

        cursor = nextCursor;
        processedKeys += keys.length;

        // Process this batch of keys
        for (const key of keys) {
          // Skip keys that BullMQ manages automatically
          if (
            key.includes(':active') ||
            key.includes(':wait') ||
            key.includes(':delayed') ||
            key.includes(':failed') ||
            key.includes(':completed')
          ) {
            continue;
          }

          // Check if the key has a TTL set
          const ttl = await this.redisClient.ttl(key);
          if (ttl === -1) {
            // -1 means key exists but no TTL is set
            // Set appropriate TTL based on key type
            let expiryTime = REDIS_JOB_TTL;

            if (key.includes(':events:')) {
              expiryTime = REDIS_EVENT_TTL;
            } else if (key.includes(':metrics')) {
              expiryTime = REDIS_METRICS_TTL;
            } else if (key.includes(':meta')) {
              continue; // Skip meta keys as they should live as long as the app runs
            }

            await this.redisClient.expire(key, expiryTime);
            this.logger.debug(`Set TTL of ${expiryTime}s for key: ${key}`);
          }
        }
      } while (cursor !== '0');

      this.logger.debug(
        `Processed ${processedKeys} Redis keys for queue: ${queueName}`,
      );
    } catch (error) {
      this.logger.error(
        `Error cleaning up orphaned keys for ${queueName}:`,
        error,
      );
    }
  }

  async onModuleDestroy() {
    this.logger.log('Closing Redis connection and cleanup resources');

    // Clear the cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clean up queue event listeners
    if (this.jobQueueEvents) {
      await this.jobQueueEvents.close();
    }

    if (this.testQueueEvents) {
      await this.testQueueEvents.close();
    }

    if (this.jobQueueEventsConnection) {
      await this.jobQueueEventsConnection.quit();
    }

    if (this.testQueueEventsConnection) {
      await this.testQueueEventsConnection.quit();
    }

    // Close Redis connection
    await this.redisClient.quit();
  }
}
