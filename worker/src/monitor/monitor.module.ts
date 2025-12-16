import { Module, DynamicModule, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { MonitorService } from './monitor.service';
import {
  MonitorProcessorUSEast,
  MonitorProcessorEUCentral,
  MonitorProcessorAsiaPacific,
} from './monitor.processor';
import { MONITOR_QUEUES } from './monitor.constants';
import { DbModule } from '../db/db.module';
import { NotificationModule } from '../notification/notification.module';
import { ExecutionModule } from '../execution.module';
import { MonitorAlertService } from './services/monitor-alert.service';
import { ValidationService } from '../common/validation/validation.service';
import { EnhancedValidationService } from '../common/validation/enhanced-validation.service';
import { CredentialSecurityService } from '../common/security/credential-security.service';
import { StandardizedErrorHandler } from '../common/errors/standardized-error-handler';
import { ResourceManagerService } from '../common/resources/resource-manager.service';
import { LocationModule } from '../common/location/location.module';

// Define job options for monitor execution queues
// Monitor checks are typically short-lived (< 1 minute), but we set reasonable limits
const monitorJobOptions = {
  removeOnComplete: { count: 500, age: 24 * 3600 }, // Keep completed jobs for 24 hours (500 max)
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 }, // Keep failed jobs for 7 days (1000 max)
  attempts: 2, // Retry up to 2 times for transient failures
  backoff: {
    type: 'exponential' as const,
    delay: 2000, // Start with 2 second delay, then 4s
  },
};

// Queue settings with proper timeout for monitor checks
const monitorQueueSettings = {
  ...monitorJobOptions,
  lockDuration: 5 * 60 * 1000, // 5 minutes - must be >= max execution time for monitor checks
  stallInterval: 30000, // Check for stalled jobs every 30 seconds
  maxStalledCount: 2, // Move job back to waiting max 2 times before failing
};

// Common providers that all configurations need
const commonProviders = [
  MonitorService,
  MonitorAlertService,
  ValidationService,
  EnhancedValidationService,
  CredentialSecurityService,
  StandardizedErrorHandler,
  ResourceManagerService,
];

/**
 * Valid WORKER_LOCATION values:
 * - 'local': Development mode - processes ALL queues on a single worker
 * - 'us-east': US East regional worker - processes us-east queue only
 * - 'eu-central': EU Central regional worker - processes eu-central queue only
 * - 'asia-pacific': Asia Pacific regional worker - processes asia-pacific queue only
 *
 * NOTE: Monitors MUST run in their specified location for accurate results.
 * There is no global/fallback queue - each monitor runs only in its designated region.
 */
const VALID_LOCATIONS = ['local', 'us-east', 'eu-central', 'asia-pacific'] as const;
type WorkerLocation = (typeof VALID_LOCATIONS)[number];

function isValidLocation(location: string): location is WorkerLocation {
  return VALID_LOCATIONS.includes(location as WorkerLocation);
}

/**
 * MonitorModule with location-aware processor registration
 *
 * Architecture:
 * - Each regional worker processes ONLY its regional queue
 * - Monitors must run in their specified location for meaningful latency data
 * - No global/fallback queue - this ensures location accuracy
 *
 * Queue distribution per worker:
 * - local: monitor-us-east + monitor-eu-central + monitor-asia-pacific (all regions)
 * - us-east: monitor-us-east only
 * - eu-central: monitor-eu-central only
 * - asia-pacific: monitor-asia-pacific only
 */
@Module({})
export class MonitorModule {
  private static readonly logger = new Logger('MonitorModule');

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
      MonitorModule.logger.warn(`${errorMessage}. Defaulting to 'local' mode in development.`);
    }

    const effectiveLocation = isValidLocation(workerLocation) ? workerLocation : 'local';
    const { queues, processors } = MonitorModule.getQueuesAndProcessors(effectiveLocation);

    MonitorModule.logger.log(
      `MonitorModule initialized [${effectiveLocation}]: ${queues.map((q) => q.name).join(', ')}`,
    );

    return {
      module: MonitorModule,
      imports: [
        BullModule.registerQueue(
          ...queues.map((q) => ({ ...q, ...monitorQueueSettings })),
        ),
        HttpModule,
        DbModule,
        NotificationModule,
        ExecutionModule,
        LocationModule,
      ],
      providers: [...commonProviders, ...processors],
      exports: [MonitorService],
    };
  }

  /**
   * Get queues and processors based on worker location.
   * Each worker processes ONLY its regional queue (no global fallback).
   */
  private static getQueuesAndProcessors(location: WorkerLocation): {
    queues: { name: string }[];
    processors: any[];
  } {
    switch (location) {
      case 'local':
        // Development: register ALL regional queues for single-worker testing
        return {
          queues: [
            { name: MONITOR_QUEUES.US_EAST },
            { name: MONITOR_QUEUES.EU_CENTRAL },
            { name: MONITOR_QUEUES.ASIA_PACIFIC },
          ],
          processors: [
            MonitorProcessorUSEast,
            MonitorProcessorEUCentral,
            MonitorProcessorAsiaPacific,
          ],
        };

      case 'us-east':
        return {
          queues: [{ name: MONITOR_QUEUES.US_EAST }],
          processors: [MonitorProcessorUSEast],
        };

      case 'eu-central':
        return {
          queues: [{ name: MONITOR_QUEUES.EU_CENTRAL }],
          processors: [MonitorProcessorEUCentral],
        };

      case 'asia-pacific':
        return {
          queues: [{ name: MONITOR_QUEUES.ASIA_PACIFIC }],
          processors: [MonitorProcessorAsiaPacific],
        };
    }
  }
}
