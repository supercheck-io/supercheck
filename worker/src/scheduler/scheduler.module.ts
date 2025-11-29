import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  K6JobSchedulerProcessor,
  PlaywrightJobSchedulerProcessor,
} from './processors/job-scheduler.processor';
import { MonitorSchedulerProcessor } from './processors/monitor-scheduler.processor';
import {
  JOB_SCHEDULER_QUEUE,
  MONITOR_SCHEDULER_QUEUE,
  JOB_EXECUTION_QUEUE,
  K6_JOB_EXECUTION_QUEUE,
  MONITOR_EXECUTION_QUEUE,
  K6_JOB_SCHEDULER_QUEUE,
} from './constants';
import { MONITOR_QUEUES } from '../monitor/monitor.constants';
import { DbModule } from '../db/db.module';
import { MonitorModule } from '../monitor/monitor.module';
import { LocationModule } from '../common/location/location.module';

// Define job options for scheduler queues
// Schedulers are typically fast (< 30 seconds)
const schedulerJobOptions = {
  removeOnComplete: { count: 500, age: 24 * 3600 }, // Keep completed jobs for 24 hours (500 max)
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 }, // Keep failed jobs for 7 days (1000 max)
  attempts: 2, // Retry up to 2 times for transient failures
  backoff: {
    type: 'exponential' as const,
    delay: 2000, // Start with 2 second delay
  },
};

// Queue settings with proper timeout for scheduler queues
const schedulerQueueSettings = {
  ...schedulerJobOptions,
  lockDuration: 2 * 60 * 1000, // 2 minutes - must be >= max execution time for schedulers
  stallInterval: 30000, // Check for stalled jobs every 30 seconds
  maxStalledCount: 2, // Move job back to waiting max 2 times before failing
};

@Module({
  imports: [
    DbModule,
    MonitorModule,
    LocationModule,
    BullModule.registerQueue(
      { name: JOB_SCHEDULER_QUEUE, ...schedulerQueueSettings },
      { name: K6_JOB_SCHEDULER_QUEUE, ...schedulerQueueSettings },
      { name: MONITOR_SCHEDULER_QUEUE, ...schedulerQueueSettings },
      // Queues that the schedulers will add jobs to
      { name: JOB_EXECUTION_QUEUE, ...schedulerQueueSettings },
      { name: K6_JOB_EXECUTION_QUEUE, ...schedulerQueueSettings },
      { name: MONITOR_EXECUTION_QUEUE, ...schedulerQueueSettings },
      { name: MONITOR_QUEUES.US_EAST, ...schedulerQueueSettings },
      { name: MONITOR_QUEUES.EU_CENTRAL, ...schedulerQueueSettings },
      { name: MONITOR_QUEUES.ASIA_PACIFIC, ...schedulerQueueSettings },
    ),
  ],
  providers: [
    PlaywrightJobSchedulerProcessor,
    K6JobSchedulerProcessor,
    MonitorSchedulerProcessor,
  ],
})
export class SchedulerModule {}
