import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { buildRedisOptions } from '../common/redis/redis-options';
import {
  registerIntakeStopper,
  stopIntake,
  trackInFlight,
} from '../common/shutdown-intake';
import { consumesWorkerQueue } from '../common/worker-queues';
import { SETUP_SCAN_QUEUE, processSetupScan } from './setup-scan.processor';

/**
 * Consumes the `setup-scan` queue. Started only where the `monitor` queues are consumed (same
 * WORKER_QUEUES gate as the monitor workers): no new token, and a scan is a plain outbound check.
 */
@Injectable()
export class SetupScanWorkerService
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(SetupScanWorkerService.name);
  private worker: Worker | null = null;
  private connection: Redis | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    registerIntakeStopper(() => this.worker?.pause(true));
    if (!consumesWorkerQueue('monitor')) {
      this.logger.log(
        'WORKER_QUEUES excludes "monitor": setup scans will not be consumed',
      );
      return;
    }
    this.connection = new Redis(buildRedisOptions(this.configService));
    this.worker = new Worker(
      SETUP_SCAN_QUEUE,
      (job: Job) => trackInFlight(() => processSetupScan(job.data)),
      {
        connection: this.connection,
        concurrency: 2,
        // A scan is bounded to 60 s; the lock leaves room for a slow final SSL read.
        lockDuration: 90_000,
      },
    );
    this.worker.on('error', (error: Error) =>
      this.logger.error(`setup-scan worker error: ${error.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await stopIntake();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    this.worker = null;
    await this.connection?.quit().catch(() => undefined);
    this.connection = null;
  }
}
