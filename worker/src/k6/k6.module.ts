import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { K6ExecutionService } from './services/k6-execution.service';
import {
  K6ExecutionProcessor,
  K6ExecutionProcessorUS,
  K6ExecutionProcessorEU,
  K6ExecutionProcessorAPAC,
} from './processors/k6-execution.processor';
import { K6_QUEUE, K6_QUEUES } from './k6.constants';
import { ExecutionModule } from '../execution.module';
import { SecurityModule } from '../common/security/security.module';

const k6MaxAttempts = Math.max(
  parseInt(process.env.K6_BULL_ATTEMPTS || '1', 10) || 1,
  1,
);

// Define job options with TTL settings
const defaultJobOptions = {
  removeOnComplete: { count: 500, age: 24 * 3600 }, // Keep completed jobs for 24 hours (500 max)
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 }, // Keep failed jobs for 7 days (1000 max)
  attempts: k6MaxAttempts,
  backoff: { type: 'exponential', delay: 1000 },
};

@Module({
  imports: [
    ExecutionModule, // Import ExecutionModule to get S3Service and RedisService
    SecurityModule, // Import SecurityModule for container execution
    BullModule.registerQueue(
      {
        name: K6_QUEUE,
        defaultJobOptions,
      },
      {
        name: K6_QUEUES.US,
        defaultJobOptions,
      },
      {
        name: K6_QUEUES.EU,
        defaultJobOptions,
      },
      {
        name: K6_QUEUES.APAC,
        defaultJobOptions,
      },
    ),
  ],
  providers: [
    K6ExecutionService,
    K6ExecutionProcessor,
    K6ExecutionProcessorUS,
    K6ExecutionProcessorEU,
    K6ExecutionProcessorAPAC,
  ],
  exports: [K6ExecutionService],
})
export class K6Module {}
