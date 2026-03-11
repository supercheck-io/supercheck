import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ExecutionModule } from '../execution.module';
import { HeartbeatModule } from '../common/heartbeat/heartbeat.module';

@Module({
  imports: [ExecutionModule, HeartbeatModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
