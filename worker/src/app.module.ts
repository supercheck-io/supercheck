import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ExecutionModule } from './execution.module';
import { K6Module } from './k6/k6.module';
import { MonitorModule } from './monitor/monitor.module';
import { NotificationModule } from './notification/notification.module';
// SchedulerModule removed - scheduler now runs in the App for capacity management
import { HealthModule } from './health/health.module';
import { EmailTemplateModule } from './email-template/email-template.module';
import { LoggerModule } from './logger/logger.module';
import { QueueAlertingModule } from './queue-alerting/queue-alerting.module';
import { HeartbeatModule } from './common/heartbeat/heartbeat.module';
import { buildRedisOptions } from './common/redis/redis-options';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    LoggerModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisOptions(configService),
      }),
      inject: [ConfigService],
    }),
    ExecutionModule,
    K6Module.forRoot(), // Location-aware K6 queue registration
    MonitorModule.forRoot(), // Location-aware Monitor queue registration
    NotificationModule,
    // SchedulerModule removed - now part of App
    HealthModule,
    EmailTemplateModule,
    QueueAlertingModule,
    HeartbeatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
