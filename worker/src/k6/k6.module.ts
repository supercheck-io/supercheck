import { Module, DynamicModule, Logger } from '@nestjs/common';
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

// Queue settings with proper timeout for K6 (up to 60 minutes execution time)
// CRITICAL: lockDuration must be >= max execution time to prevent jobs from being marked as stalled
const queueSettings = {
  defaultJobOptions,
  lockDuration: 70 * 60 * 1000, // 70 minutes - must be >= max execution time (60 min for K6 tests)
  stallInterval: 30000, // Check for stalled jobs every 30 seconds
  maxStalledCount: 2, // Move job back to waiting max 2 times before failing
};

/**
 * Valid WORKER_LOCATION values:
 * - 'local': Development mode - processes ALL queues on a single worker
 * - 'us-east': US East regional worker - processes us-east + global queues
 * - 'eu-central': EU Central regional worker - processes eu-central + global queues
 * - 'asia-pacific': Asia Pacific regional worker - processes asia-pacific + global queues
 */
const VALID_LOCATIONS = ['local', 'us-east', 'eu-central', 'asia-pacific'] as const;
type WorkerLocation = (typeof VALID_LOCATIONS)[number];

function isValidLocation(location: string): location is WorkerLocation {
  return VALID_LOCATIONS.includes(location as WorkerLocation);
}

/**
 * K6Module with location-aware processor registration
 *
 * Architecture:
 * - Each regional worker processes its regional queue + global queue for load balancing
 * - Global queue (k6-global) is for jobs without specific location requirements
 * - All regional workers help process global queue jobs (distributed processing)
 *
 * Queue distribution per worker:
 * - local: k6-global + k6-us-east + k6-eu-central + k6-asia-pacific (all queues)
 * - us-east: k6-us-east + k6-global
 * - eu-central: k6-eu-central + k6-global
 * - asia-pacific: k6-asia-pacific + k6-global
 */
@Module({})
export class K6Module {
  private static readonly logger = new Logger('K6Module');

  static forRoot(): DynamicModule {
    const workerLocation = process.env.WORKER_LOCATION || 'local';
    const nodeEnv = process.env.NODE_ENV || 'development';

    // Validate WORKER_LOCATION - fail fast in production to prevent misconfiguration
    if (!isValidLocation(workerLocation)) {
      const errorMessage =
        `Invalid WORKER_LOCATION="${workerLocation}". ` +
        `Valid values: ${VALID_LOCATIONS.join(', ')}`;

      if (nodeEnv === 'production') {
        throw new Error(`${errorMessage}. This error is fatal in production to prevent queue misrouting.`);
      }
      K6Module.logger.warn(`${errorMessage}. Defaulting to 'local' mode in development.`);
    }

    const effectiveLocation = isValidLocation(workerLocation) ? workerLocation : 'local';
    const { queues, processors } = K6Module.getQueuesAndProcessors(effectiveLocation);

    K6Module.logger.log(
      `K6Module initialized [${effectiveLocation}]: ${queues.map((q) => q.name).join(', ')}`,
    );

    return {
      module: K6Module,
      imports: [
        ExecutionModule,
        SecurityModule,
        BullModule.registerQueue(
          ...queues.map((q) => ({ ...q, ...queueSettings })),
        ),
      ],
      providers: [K6ExecutionService, ...processors],
      exports: [K6ExecutionService],
    };
  }

  /**
   * Get queues and processors based on worker location.
   * Regional workers process their regional queue + global queue for load balancing.
   */
  private static getQueuesAndProcessors(location: WorkerLocation): {
    queues: { name: string }[];
    processors: any[];
  } {
    switch (location) {
      case 'local':
        // Development: register ALL queues for single-worker testing
        return {
          queues: [
            { name: K6_QUEUE },
            { name: K6_QUEUES.US_EAST },
            { name: K6_QUEUES.EU_CENTRAL },
            { name: K6_QUEUES.ASIA_PACIFIC },
          ],
          processors: [
            K6ExecutionProcessor,
            K6ExecutionProcessorUS,
            K6ExecutionProcessorEU,
            K6ExecutionProcessorAPAC,
          ],
        };

      case 'us-east':
        return {
          queues: [
            { name: K6_QUEUES.US_EAST },
            { name: K6_QUEUE }, // Global queue for load balancing
          ],
          processors: [K6ExecutionProcessorUS, K6ExecutionProcessor],
        };

      case 'eu-central':
        return {
          queues: [
            { name: K6_QUEUES.EU_CENTRAL },
            { name: K6_QUEUE }, // Global queue for load balancing
          ],
          processors: [K6ExecutionProcessorEU, K6ExecutionProcessor],
        };

      case 'asia-pacific':
        return {
          queues: [
            { name: K6_QUEUES.ASIA_PACIFIC },
            { name: K6_QUEUE }, // Global queue for load balancing
          ],
          processors: [K6ExecutionProcessorAPAC, K6ExecutionProcessor],
        };
    }
  }
}
