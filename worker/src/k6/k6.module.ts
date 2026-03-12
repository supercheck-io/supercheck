import { Module, DynamicModule, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { K6ExecutionService } from './services/k6-execution.service';
import { K6ExecutionProcessor } from './processors/k6-execution.processor';
import { K6DynamicWorkerService } from './processors/k6-dynamic-worker.service';
import { K6_QUEUE, k6QueueName } from './k6.constants';
import { ExecutionModule } from '../execution.module';
import { SecurityModule } from '../common/security/security.module';
import { DbModule } from '../db/db.module';

// Define job options with TTL settings and retry configuration
const defaultJobOptions = {
  removeOnComplete: { count: 500, age: 24 * 3600 },
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
};

// Queue settings with proper timeout for K6 (up to 60 minutes execution time)
const queueSettings = {
  defaultJobOptions,
  lockDuration: 70 * 60 * 1000,
  stallInterval: 30000,
  maxStalledCount: 2,
};

/**
 * K6Module with dynamic location-aware processor registration.
 *
 * WORKER_LOCATION accepts any value:
 * - 'local': Development mode — processes global + all default region queues
 * - Any location code (e.g. 'us-east', 'brazil', etc.): processes k6-{code} + k6-global
 *
 * The single K6ExecutionProcessor handles ALL queues via BullMQ Workers
 * created at module init. Per-region @Processor subclasses are no longer needed.
 */
@Module({})
export class K6Module {
  private static readonly logger = new Logger('K6Module');

  static forRoot(): DynamicModule {
    const workerLocation = (
      process.env.WORKER_LOCATION || 'local'
    ).toLowerCase();

    const queueNames = K6Module.getQueueNames(workerLocation);

    K6Module.logger.log(
      `K6Module initialized [${workerLocation}]: ${queueNames.join(', ')}`,
    );

    return {
      module: K6Module,
      imports: [
        ExecutionModule,
        SecurityModule,
        DbModule,
        BullModule.registerQueue(
          ...queueNames.map((name) => ({ name, ...queueSettings })),
        ),
      ],
      providers: [
        K6ExecutionService,
        K6ExecutionProcessor,
        K6DynamicWorkerService,
      ],
      exports: [K6ExecutionService],
    };
  }

  /**
   * Build queue names based on worker location.
   * - 'local': k6-global + all default region queues
   * - specific code: k6-{code} + k6-global
   */
  private static getQueueNames(location: string): string[] {
    if (location === 'local') {
      // Development: global + local queue
      // Dynamic regional queues are discovered at runtime by K6DynamicWorkerService
      return [K6_QUEUE, k6QueueName('local')];
    }

    // Production: location-specific queue + global queue
    const names = new Set<string>([K6_QUEUE, k6QueueName(location)]);
    return Array.from(names);
  }
}
