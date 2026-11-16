import { Module } from '@nestjs/common';
import { SetupScanWorkerService } from './setup-scan.worker.service';

@Module({ providers: [SetupScanWorkerService] })
export class SetupModule {}
