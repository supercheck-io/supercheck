import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { MonitorService } from './monitor.service';
import {
  MonitorProcessor,
  MonitorProcessorUSEast,
  MonitorProcessorEUCentral,
  MonitorProcessorAsiaPacific,
} from './monitor.processor';
import { MONITOR_EXECUTION_QUEUE, MONITOR_QUEUES } from './monitor.constants';
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

@Module({
  imports: [
    BullModule.registerQueue(
      { name: MONITOR_EXECUTION_QUEUE },
      { name: MONITOR_QUEUES.US_EAST },
      { name: MONITOR_QUEUES.EU_CENTRAL },
      { name: MONITOR_QUEUES.ASIA_PACIFIC },
    ),
    HttpModule,
    DbModule,
    NotificationModule,
    ExecutionModule,
    LocationModule,
  ],
  providers: [
    MonitorService,
    MonitorProcessor,
    MonitorProcessorUSEast,
    MonitorProcessorEUCentral,
    MonitorProcessorAsiaPacific,
    MonitorAlertService,
    ValidationService,
    EnhancedValidationService,
    CredentialSecurityService,
    StandardizedErrorHandler,
    ResourceManagerService,
  ],
  exports: [MonitorService],
})
export class MonitorModule {}
