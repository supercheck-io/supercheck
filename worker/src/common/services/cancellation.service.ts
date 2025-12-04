import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Service to manage execution cancellation signals
 *
 * Uses Redis to store cancellation flags that workers can check
 * during execution to stop processing when a user cancels a run.
 */
@Injectable()
export class CancellationService {
  private readonly logger = new Logger(CancellationService.name);
  private redisClient: Redis | null = null;
  private readonly CANCELLATION_KEY_PREFIX = 'supercheck:cancel:';
  private readonly CANCELLATION_TTL = 3600; // 1 hour TTL for cancellation flags

  constructor(private readonly configService: ConfigService) {
    this.setupRedisConnection();
  }

  private setupRedisConnection(): void {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const tlsEnabled =
      this.configService.get<string>('REDIS_TLS_ENABLED', 'false') === 'true';

    this.redisClient = new Redis({
      host,
      port,
      password,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
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

    this.redisClient.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`, err.stack);
    });

    this.logger.log('Cancellation service Redis connection established');
  }

  /**
   * Set a cancellation signal for a run
   * @param runId - The run ID to cancel
   */
  async setCancellationSignal(runId: string): Promise<void> {
    if (!this.redisClient) {
      this.logger.warn(
        'Redis client not ready, cannot set cancellation signal',
      );
      return;
    }

    try {
      const key = `${this.CANCELLATION_KEY_PREFIX}${runId}`;
      await this.redisClient.setex(key, this.CANCELLATION_TTL, '1');
      this.logger.log(`Cancellation signal set for run ${runId}`);
    } catch (error) {
      this.logger.error(
        `Failed to set cancellation signal for ${runId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Check if a run has been cancelled
   * @param runId - The run ID to check
   * @returns true if cancelled, false otherwise
   */
  async isCancelled(runId: string): Promise<boolean> {
    if (!this.redisClient) {
      this.logger.warn('Redis client not ready, assuming not cancelled');
      return false;
    }

    try {
      const key = `${this.CANCELLATION_KEY_PREFIX}${runId}`;
      const result = await this.redisClient.get(key);
      return result === '1';
    } catch (error) {
      this.logger.error(
        `Failed to check cancellation for ${runId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return false;
    }
  }

  /**
   * Clear the cancellation signal for a run
   * @param runId - The run ID to clear
   */
  async clearCancellationSignal(runId: string): Promise<void> {
    if (!this.redisClient) {
      this.logger.warn(
        'Redis client not ready, cannot clear cancellation signal',
      );
      return;
    }

    try {
      const key = `${this.CANCELLATION_KEY_PREFIX}${runId}`;
      await this.redisClient.del(key);
      this.logger.log(`Cancellation signal cleared for run ${runId}`);
    } catch (error) {
      this.logger.error(
        `Failed to clear cancellation signal for ${runId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.redisClient) {
      this.redisClient.disconnect();
      this.redisClient = null;
    }
    this.logger.log('Cancellation service cleaned up');
  }
}
