import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PLAYWRIGHT_QUEUE } from '../constants';

/**
 * Queue Status Service - Centralized Bull Queue Status Management
 *
 * OPTIMIZED FOR SCALE (v1.2.4+):
 * Removed QueueEvents listeners that were only used for debug logging.
 * Workers process jobs directly via Worker processors - they don't need
 * to listen to queue events separately. This saves 2 Redis connections
 * per worker pod, critical when scaling to 50+ workers.
 *
 * Connection savings: ~100 connections at 50 workers scale.
 *
 * NOTE: Database status updates are handled by the job execution processor.
 * The App's QueueEventHub handles real-time status updates to clients.
 */
@Injectable()
export class QueueStatusService {
  private readonly logger = new Logger(QueueStatusService.name);

  constructor(@InjectQueue(PLAYWRIGHT_QUEUE) private readonly queue: Queue) {
    this.logger.log(
      'QueueStatusService initialized (no QueueEvents - optimized for scale)',
    );
  }

  /**
   * Get queue statistics for monitoring
   */
  async getQueueStats() {
    const counts = await this.queue.getJobCounts();
    return {
      waiting: counts.waiting,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
    };
  }
}
