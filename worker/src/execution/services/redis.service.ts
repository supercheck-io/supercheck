import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, RedisOptions } from 'ioredis';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PLAYWRIGHT_QUEUE } from '../constants';
import { DbService } from './db.service';
import { buildRedisOptions } from '../../common/redis/redis-options';

// Constants for Redis TTL
const REDIS_JOB_TTL = 7 * 24 * 60 * 60; // 7 days for job data
const REDIS_CLEANUP_BATCH_SIZE = 100; // Process keys in smaller batches to reduce memory pressure

/**
 * Redis Service for application-wide Redis operations and Bull queue cleanup
 *
 * It handles direct Redis client operations and the automated cleanup of Redis keys
 * and terminal jobs to prevent memory growth. Job status reaches the database from the
 * job execution processors.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private redisClient: Redis;
  private readonly redisOptions: RedisOptions;
  // Initialized synchronously by setupRedisCleanup() in the constructor.
  private cleanupInterval!: NodeJS.Timeout;

  constructor(
    private configService: ConfigService,
    @InjectQueue(PLAYWRIGHT_QUEUE) private queue: Queue,
    private dbService: DbService,
  ) {
    this.redisOptions = buildRedisOptions(this.configService);
    this.logger.log(
      this.configService.get<string>('REDIS_SENTINELS')
        ? 'Initializing Redis connection through Sentinel discovery'
        : 'Initializing direct Redis connection',
    );

    this.redisClient = new Redis(this.redisOptions);

    this.redisClient.on('error', (err) =>
      this.logger.error('Redis Error:', err),
    );
    this.redisClient.on('connect', () => this.logger.log('Redis Connected'));
    this.redisClient.on('ready', () => this.logger.log('Redis Ready'));

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
      const key = `bull:${queueName}:wait`;
      await this.redisClient.llen(key);
      return true;
    } catch (error) {
      this.logger.warn(`Queue health check failed for ${queueName}:`, error);
      return false;
    }
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
      await this.queue.clean(
        REDIS_JOB_TTL * 1000,
        REDIS_CLEANUP_BATCH_SIZE,
        'completed',
      );
      await this.queue.clean(
        REDIS_JOB_TTL * 1000,
        REDIS_CLEANUP_BATCH_SIZE,
        'failed',
      );

      // 2. Trim event streams to reduce memory usage
      await this.queue.trimEvents(1000);

      // 3. Repair unsafe TTLs left by older cleanup code
      await this.cleanupOrphanedKeys(PLAYWRIGHT_QUEUE);

      this.logger.log('Redis cleanup completed successfully');
    } catch (error) {
      this.logger.error('Error during Redis cleanup operations:', error);
    }
  }

  /**
   * Repairs legacy expiry on durable BullMQ keys
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

        // Repair durable keys in bounded pipelines; BullMQ leases keep native TTLs.
        const durable: string[] = [];
        const candidates: string[] = [];
        for (const key of keys) {
          const suffix = key.slice(`bull:${queueName}:`.length);
          if (
            suffix === 'limiter' ||
            suffix === 'stalled-check' ||
            suffix.startsWith('de:') ||
            suffix.endsWith(':lock')
          )
            continue;
          if (
            /^(id|wait|active|paused|delayed|prioritized|waiting-children|completed|failed|stalled|repeat|meta|events|pc|marker)$/.test(
              suffix,
            ) ||
            /:(logs|dependencies|processed|failed|unsuccessful)$/.test(
              suffix,
            ) ||
            /^metrics:(completed|failed)(:data)?$/.test(suffix)
          )
            durable.push(key);
          else candidates.push(key);
        }
        if (candidates.length) {
          const types = this.redisClient.pipeline();
          candidates.forEach((key) => types.type(key));
          const results = await types.exec();
          if (!results)
            throw new Error('Queue key inspection returned no results');
          for (let i = 0; i < results.length; i++) {
            const [error, type] = results[i];
            if (error) throw error;
            if (type === 'hash') durable.push(candidates[i]);
          }
        }
        if (durable.length) {
          const repair = this.redisClient.pipeline();
          // Hashes may be live BullMQ data; unreachable hashes also persist and need a separate audit. Keep classification aligned with app/src/lib/queue.ts.
          durable.forEach((key) => repair.persist(key));
          const results = await repair.exec();
          if (!results) throw new Error('Queue key repair returned no results');
          for (const [error] of results) {
            if (error) throw error;
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

  /** After the shutdown drain: in-flight runs still publish console output and read rate limits through this client. */
  async onApplicationShutdown() {
    this.logger.log('Closing Redis connection and cleanup resources');

    // Clear the cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close Redis connection
    await this.redisClient.quit();
  }
}
