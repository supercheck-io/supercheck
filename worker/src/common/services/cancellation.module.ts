import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CancellationService } from './cancellation.service';

/**
 * Module providing cancellation signal management via Redis
 *
 * Used by:
 * - ContainerExecutorService: Polls for cancellation during container execution
 * - ExecutionModule: Exports for job processors to access
 */
@Module({
  imports: [ConfigModule],
  providers: [CancellationService],
  exports: [CancellationService],
})
export class CancellationModule {}
