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

@Module({
  imports: [
    DbModule,
    MonitorModule,
    LocationModule,
    BullModule.registerQueue(
      { name: JOB_SCHEDULER_QUEUE },
      { name: K6_JOB_SCHEDULER_QUEUE },
      { name: MONITOR_SCHEDULER_QUEUE },
      // Queues that the schedulers will add jobs to
      { name: JOB_EXECUTION_QUEUE },
      { name: K6_JOB_EXECUTION_QUEUE },
      { name: MONITOR_EXECUTION_QUEUE },
      { name: MONITOR_QUEUES.US_EAST },
      { name: MONITOR_QUEUES.EU_CENTRAL },
      { name: MONITOR_QUEUES.ASIA_PACIFIC },
    ),
  ],
  providers: [
    PlaywrightJobSchedulerProcessor,
    K6JobSchedulerProcessor,
    MonitorSchedulerProcessor,
  ],
})
export class SchedulerModule {}
