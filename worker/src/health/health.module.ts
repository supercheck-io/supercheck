import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ExecutionModule } from '../execution.module';
import { HeartbeatModule } from '../common/heartbeat/heartbeat.module';
import { ConsumerWatchdogService } from '../common/consumer-watchdog.service';

@Module({
  imports: [ExecutionModule, HeartbeatModule],
  controllers: [HealthController],
  providers: [HealthService, ConsumerWatchdogService],
  exports: [HealthService],
})
export class HealthModule {}
