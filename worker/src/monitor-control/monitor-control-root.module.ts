import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../db/db.module';
import { LoggerModule } from '../logger/logger.module';
import { BillingHoldService } from './billing-hold.service';
import { MonitorControlHealthServer } from './monitor-control-health.server';
import { MonitorControlModule } from './monitor-control.module';
import { MonitorCycleProcessor } from './monitor-cycle.processor';
import { MonitorCycleService } from './monitor-cycle.service';

/** Root module of the control-plane process (separate entrypoint, same worker image). */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    LoggerModule,
    DbModule,
    MonitorControlModule,
  ],
  providers: [
    BillingHoldService,
    MonitorCycleService,
    MonitorCycleProcessor,
    MonitorControlHealthServer,
  ],
})
export class MonitorControlRootModule {}
