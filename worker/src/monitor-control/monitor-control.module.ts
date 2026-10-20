import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../db/db.module';
import { NotificationModule } from '../notification/notification.module';
import { MonitorAlertService } from '../monitor/services/monitor-alert.service';
import { SreAlertTriageQueueService } from '../monitor/services/sre-alert-triage-queue.service';

/**
 * Control-plane module for monitor cycle closure.
 *
 * Deliberately NOT built on AppModule, ExecutionModule or MonitorModule.forRoot():
 * those start execution consumers, cleanup timers and regional queue workers.
 * Dependencies are limited to config, the database pool, notification delivery,
 * the alert service and the SRE triage queue producer.
 */
@Module({
  imports: [ConfigModule, DbModule, NotificationModule],
  providers: [MonitorAlertService, SreAlertTriageQueueService],
  exports: [MonitorAlertService],
})
export class MonitorControlModule {}
