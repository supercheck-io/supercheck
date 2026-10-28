import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildRedisOptions } from '../../common/redis/redis-options';
import { Queue } from 'bullmq';

export const SRE_ALERT_TRIAGE_QUEUE_NAME = 'sre-alert-triage';

// Keep in sync with backgroundTriageJobSchema in app/src/sre/lib/background-alert-triage.ts.
export type SreSourceRecovery = {
  sourceType: 'monitor' | 'job';
  sourceId: string;
  /** ISO timestamp of the recovery. */
  recoveredAt: string;
};

export type SreAlertTriageQueueJob =
  { alertHistoryId: string } | { sourceRecovery: SreSourceRecovery };

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

    // Failed deliveries still open incidents; only 'pending' rows are skipped.
    const sentRows = rows.filter(
      (row) => row.status === 'sent' || row.status === 'failed',
    );
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
            { jobId: `sre-alert-triage-${row.id}` },
          ),
        ),
      );
    } catch (error) {
      this.logger.error('Failed to enqueue SRE alert triage jobs', error);
    }
  }

  /**
   * Tell the app a monitor or job recovered, so its open incident can auto-resolve.
   * Sent on every recovery, even when no recovery alert is delivered.
   */
  async enqueueSourceRecovery(recovery: SreSourceRecovery): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    try {
      await this.getQueue().add(
        'source-recovery',
        { sourceRecovery: recovery },
        // One job per recovery; a fixed id would be dropped while the last one is retained.
        {
          jobId: `sre-recovery-${recovery.sourceType}-${recovery.sourceId}-${Date.parse(recovery.recoveredAt)}`,
        },
      );
    } catch (error) {
      this.logger.error('Failed to enqueue SRE source recovery job', error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  // Opening/deduping incidents from alerts needs only SRE_ENABLED (default on).
  // AI triage (SRE_AUTOMATION_ENABLED) is gated app-side. Keep in sync with
  // isSreEnabled in app/src/sre/lib/feature-gates.ts.
  private isEnabled() {
    const sre = this.configService
      .get<string>('SRE_ENABLED')
      ?.trim()
      .toLowerCase();
    return sre !== 'false' && sre !== '0';
  }

  private getQueue() {
    if (this.queue) {
      return this.queue;
    }

    this.queue = new Queue<SreAlertTriageQueueJob>(
      SRE_ALERT_TRIAGE_QUEUE_NAME,
      {
        connection: buildRedisOptions(this.configService),
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
