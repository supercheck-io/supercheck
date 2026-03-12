import { Module, DynamicModule, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { MonitorService } from './monitor.service';
import { MonitorDynamicWorkerService } from './processors/monitor-dynamic-worker.service';
import { monitorQueueName } from './monitor.constants';
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
import { VariableResolverService } from '../common/services/variable-resolver.service';

// Define job options for monitor execution queues
const monitorJobOptions = {
  removeOnComplete: { count: 500, age: 24 * 3600 },
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
  attempts: 2,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
};

const monitorQueueSettings = {
  ...monitorJobOptions,
  lockDuration: 5 * 60 * 1000,
  stallInterval: 30000,
  maxStalledCount: 2,
};

// Common providers
const commonProviders = [
  MonitorService,
  MonitorAlertService,
  ValidationService,
  EnhancedValidationService,
  CredentialSecurityService,
  StandardizedErrorHandler,
  ResourceManagerService,
  VariableResolverService,
];

/**
 * MonitorModule with dynamic location-aware worker registration.
 *
 * WORKER_LOCATION accepts any value:
 * - 'local': Development mode — processes all default region monitor queues
 * - Any location code (e.g. 'us-east', 'brazil'): processes monitor-{code} only
 *
 * Monitors MUST run in their specified location for accurate latency data.
 * There is no global/fallback queue for monitors.
 *
 * Dynamic BullMQ Workers are created at runtime by MonitorDynamicWorkerService,
 * replacing the compile-time @Processor subclasses.
 */
@Module({})
export class MonitorModule {
  private static readonly logger = new Logger('MonitorModule');

  static forRoot(): DynamicModule {
    const workerLocation = (
      process.env.WORKER_LOCATION || 'local'
    ).toLowerCase();

    const queueNames = MonitorModule.getQueueNames(workerLocation);

    MonitorModule.logger.log(
      `MonitorModule initialized [${workerLocation}]: ${queueNames.join(', ')}`,
    );

    return {
      module: MonitorModule,
      imports: [
        BullModule.registerQueue(
          ...queueNames.map((name) => ({ name, ...monitorQueueSettings })),
        ),
        HttpModule,
        DbModule,
        NotificationModule,
        ExecutionModule,
        LocationModule,
      ],
      providers: [...commonProviders, MonitorDynamicWorkerService],
      exports: [MonitorService],
    };
  }

  /**
   * Build queue names based on worker location.
   * No global queue for monitors — all are location-specific.
   */
  private static getQueueNames(location: string): string[] {
    if (location === 'local') {
      // Development: local queue only
      // Dynamic regional queues are discovered at runtime by MonitorDynamicWorkerService
      return [monitorQueueName('local')];
    }
    return [monitorQueueName(location)];
  }
}
