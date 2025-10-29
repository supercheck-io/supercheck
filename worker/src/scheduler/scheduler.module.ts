import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobSchedulerProcessor } from './processors/job-scheduler.processor';
import { MonitorSchedulerProcessor } from './processors/monitor-scheduler.processor';
import {
  JOB_SCHEDULER_QUEUE,
  MONITOR_SCHEDULER_QUEUE,
  JOB_EXECUTION_QUEUE,
  MONITOR_EXECUTION_QUEUE,
} from './constants';
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
      { name: MONITOR_SCHEDULER_QUEUE },
      // Queues that the schedulers will add jobs to
      { name: JOB_EXECUTION_QUEUE },
      { name: MONITOR_EXECUTION_QUEUE },
    ),
  ],
  providers: [JobSchedulerProcessor, MonitorSchedulerProcessor],
})
export class SchedulerModule {}
