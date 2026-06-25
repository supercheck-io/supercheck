import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

export const SRE_ALERT_TRIAGE_QUEUE_NAME = 'sre-alert-triage';

export type SreAlertTriageQueueJob = {
  alertHistoryId: string;
};

export type AlertHistoryTriageCandidate = {
  id: string;
  status: string;
};

@Injectable()
export class SreAlertTriageQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(SreAlertTriageQueueService.name);
  private queue: Queue<SreAlertTriageQueueJob> | null = null;

  constructor(private readonly configService: ConfigService) {}

  async enqueueAlertHistoryRows(
    rows: AlertHistoryTriageCandidate[],
  ): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const sentRows = rows.filter((row) => row.status === 'sent');
    if (sentRows.length === 0) {
      return;
    }

    try {
      const queue = this.getQueue();
      await Promise.all(
        sentRows.map((row) =>
          queue.add(
            'triage-alert-history',
            { alertHistoryId: row.id },
            { jobId: `sre-alert-triage:${row.id}` },
          ),
        ),
      );
    } catch (error) {
      this.logger.error('Failed to enqueue SRE alert triage jobs', error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  private isEnabled() {
    return (
      this.configService.get<string>('SRE_TRIAGE_AGENT_ENABLED') === 'true' &&
      this.configService.get<string>('SRE_TRIAGE_AGENT_BACKGROUND_ENABLED') ===
        'true'
    );
  }

  private getQueue() {
    if (this.queue) {
      return this.queue;
    }

    const tlsEnabled =
      this.configService.get<string>('REDIS_TLS_ENABLED', 'false') === 'true';
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');
    const redisUsername = this.configService.get<string>('REDIS_USERNAME');

    this.queue = new Queue<SreAlertTriageQueueJob>(
      SRE_ALERT_TRIAGE_QUEUE_NAME,
      {
        connection: {
          host: this.configService.get<string>('REDIS_HOST', 'localhost'),
          port: this.configService.get<number>('REDIS_PORT', 6379),
          password: redisPassword,
          username: redisUsername,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          tls: tlsEnabled
            ? {
                rejectUnauthorized:
                  this.configService.get<string>(
                    'REDIS_TLS_REJECT_UNAUTHORIZED',
                    'true',
                  ) !== 'false',
              }
            : undefined,
        },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
          removeOnFail: { age: 14 * 24 * 60 * 60, count: 1000 },
        },
      },
    );

    this.queue.on('error', (error) => {
      this.logger.error('SRE alert triage queue error', error);
    });

    return this.queue;
  }
}
