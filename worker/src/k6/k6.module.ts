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

// Define job options with TTL settings and retry configuration
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
    ExecutionModule, // Import ExecutionModule to get S3Service and RedisService
    SecurityModule, // Import SecurityModule for container execution
    BullModule.registerQueue(
      {
        name: K6_QUEUE,
        defaultJobOptions,
      },
      {
        name: K6_QUEUES.US_EAST,
        defaultJobOptions,
      },
      {
        name: K6_QUEUES.EU_CENTRAL,
        defaultJobOptions,
      },
      {
        name: K6_QUEUES.ASIA_PACIFIC,
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
