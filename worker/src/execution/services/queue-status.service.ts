import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { JOB_EXECUTION_QUEUE, TEST_EXECUTION_QUEUE } from '../constants';
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
  private jobQueueEvents?: QueueEvents;
  private testQueueEvents?: QueueEvents;
  private jobQueueEventsConnection: RedisLike | null = null;
  private testQueueEventsConnection: RedisLike | null = null;

  constructor(
    @InjectQueue(JOB_EXECUTION_QUEUE) private readonly jobQueue: Queue,
    @InjectQueue(TEST_EXECUTION_QUEUE) private readonly testQueue: Queue,
  ) {
    void this.initializeQueueListeners();
  }

  /**
   * Sets up listeners for Bull queue events for logging and monitoring
   * Database updates are handled by the job execution processor to avoid race conditions
   */
  private async initializeQueueListeners() {
    try {
      const jobClient = await this.jobQueue.client;
      const jobConnection = jobClient.duplicate();
      await jobConnection.connect();
      jobConnection.on('error', (error: unknown) =>
        this.logger.error('Job QueueEvents connection error:', error),
      );
      this.jobQueueEventsConnection = jobConnection;

      const testClient = await this.testQueue.client;
      const testConnection = testClient.duplicate();
      await testConnection.connect();
      testConnection.on('error', (error: unknown) =>
        this.logger.error('Test QueueEvents connection error:', error),
      );
      this.testQueueEventsConnection = testConnection;

      // Set up QueueEvents for job queue
      this.jobQueueEvents = new QueueEvents(JOB_EXECUTION_QUEUE, {
        connection: jobConnection,
      });

      // Set up QueueEvents for test queue
      this.testQueueEvents = new QueueEvents(TEST_EXECUTION_QUEUE, {
        connection: testConnection,
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
    } catch (error) {
      this.logger.error('Failed to initialize queue status listeners:', error);
    }
  }

  async onModuleDestroy() {
    if (this.jobQueueEvents) {
      await this.jobQueueEvents.close();
    }
    if (this.testQueueEvents) {
      await this.testQueueEvents.close();
    }
    if (this.jobQueueEventsConnection) {
      const jobConnection = this.jobQueueEventsConnection;
      try {
        await jobConnection.quit();
      } catch (error) {
        this.logger.warn(
          'Error while quitting job QueueEvents connection, forcing disconnect:',
          error,
        );
        jobConnection.disconnect();
      }
      this.jobQueueEventsConnection = null;
    }
    if (this.testQueueEventsConnection) {
      const testConnection = this.testQueueEventsConnection;
      try {
        await testConnection.quit();
      } catch (error) {
        this.logger.warn(
          'Error while quitting test QueueEvents connection, forcing disconnect:',
          error,
        );
        testConnection.disconnect();
      }
      this.testQueueEventsConnection = null;
    }
  }
}
