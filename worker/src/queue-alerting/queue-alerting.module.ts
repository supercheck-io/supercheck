/**
 * Queue Alerting Module
 *
 * Provides queue health monitoring and alerting functionality
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueAlertingService } from './queue-alerting.service';
import { QueueAlertingController } from './queue-alerting.controller';

@Module({
  imports: [ConfigModule],
  providers: [QueueAlertingService],
  controllers: [QueueAlertingController],
  exports: [QueueAlertingService],
})
export class QueueAlertingModule {}
