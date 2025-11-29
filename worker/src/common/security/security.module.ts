import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ContainerExecutorService } from './container-executor.service';
import { CancellationModule } from '../services/cancellation.module';

/**
 * Security module providing container execution and security utilities
 *
 * Imports CancellationModule to allow ContainerExecutorService to poll
 * for cancellation signals during container execution.
 */
@Module({
  imports: [ConfigModule, CancellationModule],
  providers: [ContainerExecutorService],
  exports: [ContainerExecutorService],
})
export class SecurityModule {}
