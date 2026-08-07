import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ContainerExecutorService } from './container-executor.service';
import { CancellationModule } from '../services/cancellation.module';
import { DbModule } from '../../db/db.module';
import { VariableResolverService } from '../services/variable-resolver.service';

/**
 * Security module providing container execution and security utilities
 *
 * Imports CancellationModule to allow ContainerExecutorService to poll
 * for cancellation signals during container execution.
 */
@Module({
  imports: [ConfigModule, CancellationModule, DbModule],
  providers: [ContainerExecutorService, VariableResolverService],
  exports: [ContainerExecutorService, VariableResolverService],
})
export class SecurityModule {}
