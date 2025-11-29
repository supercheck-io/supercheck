import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { MonitorService } from './monitor.service';
import {
  MonitorProcessor,
  MonitorProcessorUSEast,
  MonitorProcessorEUCentral,
  MonitorProcessorAsiaPacific,
} from './monitor.processor';
import { MONITOR_EXECUTION_QUEUE, MONITOR_QUEUES } from './monitor.constants';
import { DbModule } from '../db/db.module';
import { NotificationModule } from '../notification/notification.module';
import { ExecutionModule } from '../execution.module';
import { MonitorAlertService } from './services/monitor-alert.service';
import { ValidationService } from '../common/validation/validation.service';
import { EnhancedValidationService } from '../common/validation/enhanced-validation.service';
import { CredentialSecurityService } from '../common/security/credential-security.service';
import { StandardizedErrorHandler } from '../common/errors/standardized-error-handler';
import { ResourceManagerService } from '../common/resources/resource-manager.service';
import { LocationModule } from '../common/location/location.module';

// Define job options for monitor execution queues
// Monitor checks are typically short-lived (< 1 minute), but we set reasonable limits
const monitorJobOptions = {
  removeOnComplete: { count: 500, age: 24 * 3600 }, // Keep completed jobs for 24 hours (500 max)
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 }, // Keep failed jobs for 7 days (1000 max)
  attempts: 2, // Retry up to 2 times for transient failures
  backoff: {
    type: 'exponential' as const,
    delay: 2000, // Start with 2 second delay, then 4s
  },
};

// Queue settings with proper timeout for monitor checks
const monitorQueueSettings = {
  ...monitorJobOptions,
  lockDuration: 5 * 60 * 1000, // 5 minutes - must be >= max execution time for monitor checks
  stallInterval: 30000, // Check for stalled jobs every 30 seconds
  maxStalledCount: 2, // Move job back to waiting max 2 times before failing
};

@Module({
  imports: [
    BullModule.registerQueue(
      { name: MONITOR_EXECUTION_QUEUE, ...monitorQueueSettings },
      { name: MONITOR_QUEUES.US_EAST, ...monitorQueueSettings },
      { name: MONITOR_QUEUES.EU_CENTRAL, ...monitorQueueSettings },
      { name: MONITOR_QUEUES.ASIA_PACIFIC, ...monitorQueueSettings },
    ),
    HttpModule,
    DbModule,
    NotificationModule,
    ExecutionModule,
    LocationModule,
  ],
  providers: [
    MonitorService,
    MonitorProcessor,
    MonitorProcessorUSEast,
    MonitorProcessorEUCentral,
    MonitorProcessorAsiaPacific,
    MonitorAlertService,
    ValidationService,
    EnhancedValidationService,
    CredentialSecurityService,
    StandardizedErrorHandler,
    ResourceManagerService,
  ],
  exports: [MonitorService],
})
export class MonitorModule {}
