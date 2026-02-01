/**
 * Queue Alerting Module
 *
 * Provides queue health monitoring and alerting functionality.
 *
 * OPTIMIZED (v1.2.4+): Uses SharedRedisModule for base Redis connection,
 * reducing connection count at scale.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueAlertingService } from './queue-alerting.service';
import { QueueAlertingController } from './queue-alerting.controller';
import { SharedRedisModule } from '../common/redis/shared-redis.module';

@Module({
  imports: [ConfigModule, SharedRedisModule],
  providers: [QueueAlertingService],
  controllers: [QueueAlertingController],
  exports: [QueueAlertingService],
})
export class QueueAlertingModule {}
