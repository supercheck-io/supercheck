import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

// Import Services and Processors
import { ExecutionService } from './execution/services/execution.service';
import { S3Service } from './execution/services/s3.service';
import { DbService } from './execution/services/db.service';
import { RedisService } from './execution/services/redis.service';
import { JobNotificationService } from './execution/services/job-notification.service';
import { UsageTrackerService } from './execution/services/usage-tracker.service';
import { StalledJobHandlerService } from './execution/services/stalled-job-handler.service';
import { HardStopNotificationService } from './execution/services/hard-stop-notification.service';
import { RequirementCoverageService } from './execution/services/requirement-coverage.service';
import { PlaywrightExecutionProcessor } from './execution/processors/playwright-execution.processor';
import { NotificationModule } from './notification/notification.module';
import { ReportUploadService } from './common/services/report-upload.service';
import { SecurityModule } from './common/security/security.module';
import { CancellationModule } from './common/services/cancellation.module';
import { DbModule } from './db/db.module';
import { SreAlertTriageQueueService } from './monitor/services/sre-alert-triage-queue.service';

// Import constants from constants file
import { PLAYWRIGHT_QUEUE } from './execution/constants';

// Define common job options with TTL settings and retry configuration
// Retries help with transient failures (container startup, network issues)
// Usage tracking only happens on successful completion, so retries don't cause duplicate billing
const defaultJobOptions = {
  removeOnComplete: { count: 500, age: 24 * 3600 }, // Keep completed jobs for 24 hours (500 max)
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 }, // Keep failed jobs for 7 days (1000 max)
  attempts: 3, // Retry up to 3 times for transient failures
  backoff: {
    type: 'exponential' as const,
    delay: 5000, // Start with 5 second delay, then 10s, 20s
  },
};

@Module({
  imports: [
    DbModule,
    NotificationModule,
    SecurityModule,
    CancellationModule,
    BullModule.registerQueue({
      name: PLAYWRIGHT_QUEUE,
      defaultJobOptions,
    }),
  ],
  providers: [
    // Add all services and processors here
    ExecutionService,
    S3Service,
    DbService,
    RedisService,
    JobNotificationService,
    SreAlertTriageQueueService,
    UsageTrackerService,
    ReportUploadService,
    HardStopNotificationService,
    RequirementCoverageService,
    // Stalled job handler - monitors for jobs stuck in "running" status
    // and marks them as error to prevent indefinite hanging
    StalledJobHandlerService,
    PlaywrightExecutionProcessor,
  ],
  exports: [
    DbModule,
    DbService,
    RedisService,
    JobNotificationService,
    UsageTrackerService,
    HardStopNotificationService,
    ExecutionService,
    S3Service,
    StalledJobHandlerService,
    CancellationModule, // Re-export for K6Module and other consumers
  ],
})
export class ExecutionModule {}
