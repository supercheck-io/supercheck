import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PLAYWRIGHT_QUEUE } from '../constants';
import type { Redis, Cluster } from 'ioredis';

type RedisLike = Redis | Cluster;

/**
 * Queue Status Service - Centralized Bull Queue Status Management
 *
 * This service manages status updates directly through Bull queues rather than
 * separate Redis pub/sub channels. This simplifies the architecture by:
 *
 * 1. Using Bull's built-in event system for status tracking
 * 2. Leveraging Bull's existing Redis data with proper TTL settings
 * 3. Removing the need for separate Redis pub/sub channels
 *
 * NOTE: Database status updates are handled by the job execution processor
 * to avoid race conditions. This service only provides logging and monitoring.
 */
@Injectable()
export class QueueStatusService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueStatusService.name);
  private queueEvents?: QueueEvents;
  private queueEventsConnection: RedisLike | null = null;

  constructor(@InjectQueue(PLAYWRIGHT_QUEUE) private readonly queue: Queue) {
    void this.initializeQueueListeners();
  }

  /**
   * Sets up listeners for Bull queue events for logging and monitoring
   * Database updates are handled by the job execution processor to avoid race conditions
   */
  private async initializeQueueListeners() {
    try {
      const client = await this.queue.client;
      const connection = client.duplicate();
      await connection.connect();
      connection.on('error', (error: unknown) =>
        this.logger.error('QueueEvents connection error:', error),
      );
      this.queueEventsConnection = connection;

      // Set up QueueEvents
      this.queueEvents = new QueueEvents(PLAYWRIGHT_QUEUE, {
        connection,
      });

      // Queue event listeners
      this.queueEvents.on('waiting', ({ jobId }) => {
        this.logger.debug(`Job ${jobId} is waiting`);
      });

      this.queueEvents.on('active', ({ jobId }) => {
        this.logger.debug(`Job ${jobId} is active`);
      });

      this.queueEvents.on('completed', ({ jobId }) => {
        this.logger.debug(`Job ${jobId} completed`);
      });

      this.queueEvents.on('failed', ({ jobId, failedReason }) => {
        this.logger.error(`Job ${jobId} failed: ${failedReason}`);
      });
    } catch (error) {
      this.logger.error('Failed to initialize queue status listeners:', error);
    }
  }

  async onModuleDestroy() {
    if (this.queueEvents) {
      await this.queueEvents.close();
    }
    if (this.queueEventsConnection) {
      const connection = this.queueEventsConnection;
      try {
        await connection.quit();
      } catch (error) {
        this.logger.warn(
          'Error while quitting QueueEvents connection, forcing disconnect:',
          error,
        );
        connection.disconnect();
      }
      this.queueEventsConnection = null;
    }
  }
}
