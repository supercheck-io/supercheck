import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HeartbeatService } from './heartbeat.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [HeartbeatService],
  exports: [HeartbeatService],
})
export class HeartbeatModule {}
