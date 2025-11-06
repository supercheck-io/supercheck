import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ExecutionModule } from './execution.module';
import { K6Module } from './k6/k6.module';
import { MonitorModule } from './monitor/monitor.module';
import { NotificationModule } from './notification/notification.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { HealthModule } from './health/health.module';
import { EmailTemplateModule } from './email-template/email-template.module';
import { LoggerModule } from './logger/logger.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    LoggerModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const tlsEnabled =
          configService.get<string>('REDIS_TLS_ENABLED', 'false') === 'true';
        const redisPassword = configService.get<string>('REDIS_PASSWORD');
        const redisUsername = configService.get<string>('REDIS_USERNAME');

        return {
          connection: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
            password: redisPassword,
            username: redisUsername,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            retryStrategy: (attempt: number) =>
              Math.min(1000 * Math.pow(2, attempt), 10000),
            tls: tlsEnabled
              ? {
                  rejectUnauthorized:
                    configService.get<string>(
                      'REDIS_TLS_REJECT_UNAUTHORIZED',
                      'true',
                    ) !== 'false',
                }
              : undefined,
          },
        };
      },
      inject: [ConfigService],
    }),
    ExecutionModule,
    K6Module,
    MonitorModule,
    NotificationModule,
    SchedulerModule,
    HealthModule,
    EmailTemplateModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
