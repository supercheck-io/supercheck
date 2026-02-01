import { Module, Global } from '@nestjs/common';
import { SharedRedisService } from './shared-redis.service';

/**
 * SharedRedisModule - Global module for shared Redis connection
 *
 * OPTIMIZATION (v1.2.4+):
 * Instead of each service creating its own Redis connection, we provide
 * a single shared connection for non-blocking operations.
 *
 * Connection savings: ~4 connections per worker pod
 * At 50 workers: 200 connections saved!
 *
 * Services that use this shared connection:
 * - CancellationService (cancellation signal checks)
 * - QueueAlertingService (queue metrics collection)
 * - Any service needing basic Redis operations (GET, SET, DEL, etc.)
 *
 * Services that DON'T need this (optimized separately):
 * - StalledJobHandlerService (database-only, no Redis needed)
 *
 * Services that still need their own connections:
 * - QueueEvents (blocking XREAD for job events)
 * - Workers (BullMQ creates internal blocking connections for BRPOPLPUSH)
 * - Queue instances in QueueAlertingService (each duplicates from shared base)
 */
@Global()
@Module({
  providers: [SharedRedisService],
  exports: [SharedRedisService],
})
export class SharedRedisModule {}
