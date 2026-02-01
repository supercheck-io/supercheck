import { Injectable, Logger } from '@nestjs/common';
import { SharedRedisService } from '../redis/shared-redis.service';

/**
 * Service to manage execution cancellation signals
 *
 * Uses Redis to store cancellation flags that workers can check
 * during execution to stop processing when a user cancels a run.
 *
 * OPTIMIZED (v1.2.4+): Uses SharedRedisService instead of creating own connection.
 * Saves 1 Redis connection per worker pod.
 */
@Injectable()
export class CancellationService {
  private readonly logger = new Logger(CancellationService.name);
  private readonly CANCELLATION_KEY_PREFIX = 'supercheck:cancel:';
  private readonly CANCELLATION_TTL = 3600; // 1 hour TTL for cancellation flags

  constructor(private readonly sharedRedis: SharedRedisService) {
    this.logger.log('CancellationService initialized (using shared Redis)');
  }

  /**
   * Set a cancellation signal for a run
   * @param runId - The run ID to cancel
   */
  async setCancellationSignal(runId: string): Promise<void> {
    try {
      const key = `${this.CANCELLATION_KEY_PREFIX}${runId}`;
      await this.sharedRedis.getClient().setex(key, this.CANCELLATION_TTL, '1');
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
    try {
      const key = `${this.CANCELLATION_KEY_PREFIX}${runId}`;
      const result = await this.sharedRedis.getClient().get(key);
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
    try {
      const key = `${this.CANCELLATION_KEY_PREFIX}${runId}`;
      await this.sharedRedis.getClient().del(key);
      this.logger.log(`Cancellation signal cleared for run ${runId}`);
    } catch (error) {
      this.logger.error(
        `Failed to clear cancellation signal for ${runId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
