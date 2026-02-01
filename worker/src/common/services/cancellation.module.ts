import { Module } from '@nestjs/common';
import { CancellationService } from './cancellation.service';
import { SharedRedisModule } from '../redis/shared-redis.module';

/**
 * Module providing cancellation signal management via Redis
 *
 * Used by:
 * - ContainerExecutorService: Polls for cancellation during container execution
 * - ExecutionModule: Exports for job processors to access
 *
 * OPTIMIZED (v1.2.4+): Uses SharedRedisModule instead of own connection.
 */
@Module({
  imports: [SharedRedisModule],
  providers: [CancellationService],
  exports: [CancellationService],
})
export class CancellationModule {}
