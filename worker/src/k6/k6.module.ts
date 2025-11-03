import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { K6ExecutionService } from './services/k6-execution.service';
import {
  K6JobExecutionProcessor,
  K6TestExecutionProcessor,
} from './processors/k6-execution.processor';
import {
  K6_JOB_EXECUTION_QUEUE,
  K6_TEST_EXECUTION_QUEUE,
} from './k6.constants';
import { ExecutionModule } from '../execution.module';

// Define job options with TTL settings
const defaultJobOptions = {
  removeOnComplete: { count: 500, age: 24 * 3600 }, // Keep completed jobs for 24 hours (500 max)
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 }, // Keep failed jobs for 7 days (1000 max)
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
};

@Module({
  imports: [
    ExecutionModule, // Import ExecutionModule to get S3Service and RedisService
    BullModule.registerQueue(
      {
        name: K6_TEST_EXECUTION_QUEUE,
        defaultJobOptions,
      },
      {
        name: K6_JOB_EXECUTION_QUEUE,
        defaultJobOptions,
      },
    ),
  ],
  providers: [
    K6ExecutionService,
    K6TestExecutionProcessor,
    K6JobExecutionProcessor,
  ],
  exports: [K6ExecutionService],
})
export class K6Module {}
