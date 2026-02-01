import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * SharedRedisService - Single shared Redis connection for non-blocking operations
 *
 * OPTIMIZATION (v1.2.4+):
 * Provides a single Redis connection that multiple services can share.
 * This dramatically reduces connection count at scale.
 *
 * Before: Each service (CancellationService, StalledJobHandler, QueueAlerting)
 *         created its own connection = 4+ connections per worker
 *
 * After:  All services share this single connection = 1 connection per worker
 *
 * Connection savings at 50 workers: ~150-200 connections
 *
 * IMPORTANT: This connection is for NON-BLOCKING operations only.
 * QueueEvents and Workers still need their own connections for blocking ops.
 */
@Injectable()
export class SharedRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SharedRedisService.name);
  private client: Redis | null = null;
  private connectionReady = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  private async connect(): Promise<void> {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const username = this.configService.get<string>('REDIS_USERNAME');
    const tlsEnabled =
      this.configService.get<string>('REDIS_TLS_ENABLED', 'false') === 'true';

    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      username: username || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 10000,
      commandTimeout: 5000,
      retryStrategy: (times: number) => {
        if (times > 5) return null;
        return Math.min(times * 500, 3000);
      },
      tls: tlsEnabled
        ? {
            rejectUnauthorized:
              this.configService.get<string>(
                'REDIS_TLS_REJECT_UNAUTHORIZED',
                'true',
              ) !== 'false',
          }
        : undefined,
    });

    this.client.on('error', (err) => {
      this.logger.error(`Shared Redis connection error: ${err.message}`);
    });

    this.client.on('connect', () => {
      this.logger.log(`Shared Redis connected to ${host}:${port}`);
    });

    // Wait for connection to be ready with timeout
    try {
      await Promise.race([
        this.client.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis connection timeout')),
            10000,
          ),
        ),
      ]);
      this.connectionReady = true;
      this.logger.log('Shared Redis connection ready');
    } catch (error) {
      this.logger.error(
        `Failed to connect to Redis: ${(error as Error).message}`,
      );
      // Throw to prevent NestJS from thinking initialization succeeded
      // Services depending on SharedRedisService will fail fast with clear errors
      throw error;
    }
  }

  /**
   * Get the shared Redis client
   * Use this for non-blocking operations (GET, SET, DEL, etc.)
   */
  getClient(): Redis {
    if (!this.client || !this.connectionReady) {
      throw new Error('Shared Redis client not initialized or not ready');
    }
    return this.client;
  }

  /**
   * Check if Redis is connected and healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.logger.log('Shared Redis connection closed');
    }
  }
}
