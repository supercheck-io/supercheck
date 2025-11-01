import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { K6ExecutionService } from './services/k6-execution.service';
import { K6ExecutionProcessor } from './processors/k6-execution.processor';
import { ExecutionModule } from '../execution.module';

// K6 execution queue name
export const K6_EXECUTION_QUEUE = 'k6-execution';

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
    BullModule.registerQueue({
      name: K6_EXECUTION_QUEUE,
      defaultJobOptions,
      // Worker concurrency is controlled by the processor options
    }),
  ],
  providers: [K6ExecutionService, K6ExecutionProcessor],
  exports: [K6ExecutionService],
})
export class K6Module {}
