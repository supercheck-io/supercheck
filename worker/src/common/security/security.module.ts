import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ContainerExecutorService } from './container-executor.service';

/**
 * Security module providing container execution and security utilities
 */
@Module({
  imports: [ConfigModule],
  providers: [ContainerExecutorService],
  exports: [ContainerExecutorService],
})
export class SecurityModule {}
