import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RUN_CANCELLATION_MARKER } from '../../common/services/cancellation.service';
import { AlertStatus, AlertType, TestRunStatus } from '../../db/schema';
import { DbService } from './db.service';
import {
  NotificationPayload,
  NotificationService,
} from '../../notification/notification.service';
import {
  type AlertHistoryTriageCandidate,
  SreAlertTriageQueueService,
} from '../../monitor/services/sre-alert-triage-queue.service';

type SimpleResult = { success: boolean } | { status: 'passed' | 'failed' };

export interface JobNotificationParams {
  jobId: string;
  organizationId?: string;
  projectId?: string;
  runId: string;
  finalStatus: TestRunStatus | 'timeout';
  durationSeconds: number;
  results?: SimpleResult[];
  jobType?: string;
  location?: string | null;
  errorMessage?: string | null;
  /** The user cancelled the run: it is neither a failure to alert on nor part of a streak. */
  cancelled?: boolean;
}

// A user-cancelled run is stored as 'error'; it must not count toward or reset a streak.
function isCancelledRun(run: { errorDetails?: string | null }) {
  return run.errorDetails === RUN_CANCELLATION_MARKER;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Mirrors the monitor rule in monitor-evaluator.ts (evaluateAndSendAlert): alert at the threshold, then
// every max(5, 2 x threshold) failures after the last alert, max 3 alerts actually sent per streak. The cap
// counts sent alerts, not failures: with failure alerts off, a long streak must still alert on a timeout.
const MAX_FAILURE_ALERTS_PER_STREAK = 3;
const ALERT_HISTORY_SAVE_ATTEMPTS = 3;
const ALERT_HISTORY_RETRY_MS = 200;

function failureAlertInterval(threshold: number) {
  return Math.max(5, threshold * 2);
}

export function maxFailureAlertStreak(threshold: number) {
  const t = Math.max(1, threshold || 1);
  return t + failureAlertInterval(t) * (MAX_FAILURE_ALERTS_PER_STREAK - 1);
}

export function isFailureAlertStreak(
  consecutiveFailures: number,
  threshold: number,
  alertsSent: number,
  failuresSinceLastAlert: number,
) {
  const t = Math.max(1, threshold || 1);
  if (consecutiveFailures < t || alertsSent >= MAX_FAILURE_ALERTS_PER_STREAK)
    return false;
  return alertsSent === 0 || failuresSinceLastAlert >= failureAlertInterval(t);
}

// Fallback when alert history cannot be read: alert at the threshold, then every interval, max 3 per streak.
function isPositionalFailureAlert(
  consecutiveFailures: number,
  threshold: number,
) {
  const t = Math.max(1, threshold || 1);
  const interval = failureAlertInterval(t);
  const after = consecutiveFailures - t;
  return (
    after >= 0 &&
    after % interval === 0 &&
    after / interval < MAX_FAILURE_ALERTS_PER_STREAK
  );
}

@Injectable()
export class JobNotificationService {
  private readonly logger = new Logger(JobNotificationService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly notificationService: NotificationService,
    private readonly sreAlertTriageQueueService: SreAlertTriageQueueService,
  ) {}

  /** Signal a recovery once: when the pass streak reaches the threshold right after a failed run. */
  private async signalRecoveryIfRecovered(
    jobId: string,
    runId: string,
    recoveryThreshold: number,
  ): Promise<void> {
    const recentRuns = await this.dbService.getRecentRunsForJob(
      jobId,
      recoveryThreshold + 1,
    );
    let passes = 1;
    let afterFailure = false;
    for (const run of recentRuns) {
      if (run.id === runId || isCancelledRun(run)) continue;
      if (run.status === 'passed') {
        passes++;
        continue;
      }
      afterFailure = run.status === 'failed' || run.status === 'error';
      break;
    }
    if (passes !== recoveryThreshold || !afterFailure) return;
    const queued = await this.sreAlertTriageQueueService.enqueueSourceRecovery({
      sourceType: 'job',
      sourceId: jobId,
      recoveredAt: new Date().toISOString(),
    });
    // Job runs have no retry loop (the streak check only matches this one run), so a dropped signal can
    // only be surfaced here. The recovery alert below is independent and still goes out.
    if (!queued) {
      this.logger.error(
        `Recovery signal for job ${jobId} was not queued; its incident stays open until resolved manually`,
      );
    }
  }

  async handleJobNotifications({
    jobId,
    organizationId,
    projectId,
    runId,
    finalStatus,
    durationSeconds,
    results,
    jobType,
    location,
    errorMessage,
    cancelled,
  }: JobNotificationParams): Promise<void> {
    try {
      if (!jobId || cancelled) {
        this.logger.debug('No jobId provided for notification handling');
        return;
      }

      const job = (await this.dbService.getJobById(
        jobId,
        organizationId,
        projectId,
      )) as {
        id: string;
        name: string;
        projectId?: string;
        alertConfig?: {
          enabled: boolean;
          notificationProviders: string[];
          failureThreshold: number;
          recoveryThreshold: number;
          alertOnFailure: boolean;
          alertOnSuccess: boolean;
          alertOnTimeout: boolean;
          customMessage?: string;
        } | null;
      } | null;

      // Before the alert checks: an open incident must auto-resolve even with alerts or channels off.
      if (job && finalStatus === 'passed') {
        await this.signalRecoveryIfRecovered(
          jobId,
          runId,
          job.alertConfig?.recoveryThreshold || 1,
        );
      }

      if (!job || !job.alertConfig?.enabled) {
        this.logger.debug(
          `No alerts configured for job ${jobId} - alertConfig: ${JSON.stringify(job?.alertConfig)}`,
        );
        return;
      }

      const alertConfig = job.alertConfig;

      const providers = await this.dbService.getNotificationProviders(
        alertConfig.notificationProviders,
        organizationId,
        projectId,
      );

      if (!providers || providers.length === 0) {
        this.logger.debug(
          `No notification providers configured for job ${jobId}`,
        );
        return;
      }

      let projectName: string | undefined;
      let effectiveJobType = jobType;
      if (job.projectId) {
        const project: { name: string } | null =
          await this.dbService.getProjectById(job.projectId);
        projectName = project?.name;
      }

      if (!effectiveJobType) {
        effectiveJobType = (job as { jobType?: string })?.jobType ?? undefined;
      }

      const recentRuns = await this.dbService.getRecentRunsForJob(
        jobId,
        Math.max(
          alertConfig.recoveryThreshold,
          // +1 so the count can pass the last alert point (otherwise it saturates there).
          maxFailureAlertStreak(alertConfig.failureThreshold) + 1,
        ),
      );

      // A timeout is a failed run for the streak; alertOnTimeout only picks the alert type.
      const normalizedStatus =
        finalStatus === 'error' || finalStatus === 'timeout'
          ? 'failed'
          : finalStatus;

      let consecutiveSuccesses = normalizedStatus === 'passed' ? 1 : 0;
      // A newer run may already have alerted: this run counts as "since the alert" only if it finished after it.
      const currentRun = recentRuns.find((run) => run.id === runId);
      const currentAt = currentRun?.completedAt ?? new Date();

      const countFailureStreak = (lastSentAt: Date | null) => {
        let consecutiveFailures = 1;
        let failuresSinceLastAlert =
          lastSentAt && currentAt <= lastSentAt ? 0 : 1;
        for (const run of recentRuns) {
          if (run.id === runId || isCancelledRun(run)) continue;
          if (run.status !== 'failed' && run.status !== 'error') break;
          consecutiveFailures++;
          // Count by completion: a run created before the alert that failed after it is a failure since it.
          const failedAt = run.completedAt ?? run.createdAt;
          if (lastSentAt && failedAt && failedAt > lastSentAt)
            failuresSinceLastAlert++;
        }
        return { consecutiveFailures, failuresSinceLastAlert };
      };

      const shouldAlertOnStreak = (state: {
        sent: number;
        lastSentAt: Date | null;
        unknown?: boolean;
      }) => {
        const counts = countFailureStreak(state.lastSentAt);
        return state.unknown
          ? isPositionalFailureAlert(
              counts.consecutiveFailures,
              alertConfig.failureThreshold,
            )
          : isFailureAlertStreak(
              counts.consecutiveFailures,
              alertConfig.failureThreshold,
              state.sent,
              state.lastSentAt
                ? counts.failuresSinceLastAlert
                : counts.consecutiveFailures,
            );
      };

      let consecutiveFailures = 0;
      let alertState: Awaited<ReturnType<DbService['getJobAlertStreakState']>> =
        { sent: 0, lastSentAt: null };
      if (normalizedStatus === 'failed') {
        alertState = await this.dbService.getJobAlertStreakState(jobId);
        consecutiveFailures = countFailureStreak(
          alertState.lastSentAt,
        ).consecutiveFailures;
      } else if (normalizedStatus === 'passed') {
        for (const run of recentRuns) {
          if (run.id === runId || isCancelledRun(run)) continue;
          if (run.status !== 'passed') break;
          consecutiveSuccesses++;
        }
      }

      const shouldNotifyFailure =
        alertConfig.alertOnFailure &&
        normalizedStatus === 'failed' &&
        shouldAlertOnStreak(alertState);

      const shouldNotifySuccess =
        alertConfig.alertOnSuccess &&
        normalizedStatus === 'passed' &&
        consecutiveSuccesses >= alertConfig.recoveryThreshold;

      // Same threshold, cadence and cap as failures; only the alert type differs.
      const shouldNotifyTimeout =
        alertConfig.alertOnTimeout &&
        finalStatus === 'timeout' &&
        shouldAlertOnStreak(alertState);

      if (
        !shouldNotifyFailure &&
        !shouldNotifySuccess &&
        !shouldNotifyTimeout
      ) {
        this.logger.debug(
          `No notification conditions met for job ${jobId} - status: ${normalizedStatus}, consecutive failures: ${consecutiveFailures}, consecutive successes: ${consecutiveSuccesses}`,
        );
        return;
      }

      const totalTests = results?.length ?? 0;
      const passedTests =
        results?.filter((item) => {
          if ('success' in item) {
            return item.success;
          }
          return item.status === 'passed';
        }).length ?? 0;
      const failedTests =
        totalTests > 0 ? totalTests - passedTests : totalTests;

      const safeDuration = Math.max(0, durationSeconds);

      let payloadType: NotificationPayload['type'];
      let alertType: AlertType;
      let severity: NotificationPayload['severity'];
      let title: string;
      let message: string;

      const isError = finalStatus === 'error';

      if (shouldNotifyTimeout) {
        payloadType = 'job_timeout';
        alertType = 'job_timeout';
        severity = 'warning';
        title = `Job Timeout - ${job.name}`;
        message = `Job "${job.name}" timed out after ${safeDuration} seconds.`;
      } else if (shouldNotifyFailure) {
        payloadType = 'job_failed';
        alertType = 'job_failed';
        severity = 'error';
        if (isError) {
          title = `Job Error - ${job.name}`;
          message = `Job "${job.name}" encountered an error during execution.`;
        } else {
          title = `Job Failed - ${job.name}`;
          message = `Job "${job.name}" has failed.`;
        }
      } else {
        payloadType = 'job_success';
        alertType = 'job_success';
        severity = 'success';
        title = `Job Completed - ${job.name}`;
        message = `Job "${job.name}" has completed successfully.`;
      }

      const payload: NotificationPayload = {
        type: payloadType,
        title,
        message: alertConfig.customMessage || message,
        targetName: job.name,
        targetId: job.id,
        severity,
        timestamp: new Date(),
        projectId: job.projectId,
        projectName,
        metadata: {
          duration: safeDuration,
          status: shouldNotifyTimeout ? 'timeout' : normalizedStatus,
          totalTests,
          passedTests,
          failedTests,
          runId,
          consecutiveFailures,
          consecutiveSuccesses,
          type: effectiveJobType,
          location: location ?? undefined,
          errorMessage: errorMessage ?? undefined,
        },
      };

      // Failure alerts reserve their (run, provider) slot before sending, under a per-job lock that re-checks
      // the cap, so concurrent or retried runs cannot over-send. Other alerts, and failure alerts when the
      // reservation itself cannot be made, are recorded after sending.
      let sendTo = providers;
      const reservedRows = new Map<string, string>();
      if (alertType === 'job_failed' || alertType === 'job_timeout') {
        try {
          const claimed = await this.dbService.claimJobAlertSlots({
            jobId,
            runId,
            type: alertType,
            providerIds: providers.map((provider) => provider.id),
            message: payload.message,
            jobName: job.name,
            shouldAlert: (state) => shouldAlertOnStreak(state),
          });
          if (claimed.size === 0) {
            this.logger.debug(
              `Failure alert for job ${jobId} run ${runId} not sent: cap reached or already claimed`,
            );
            return;
          }
          claimed.forEach((id, providerId) => reservedRows.set(providerId, id));
          sendTo = providers.filter((provider) => claimed.has(provider.id));
        } catch (claimError) {
          this.logger.error(
            `Failed to reserve alert slot for job ${jobId}; sending unreserved: ${getErrorMessage(claimError)}`,
          );
        }
      }

      const notificationResults =
        await this.notificationService.sendNotificationToMultipleProviders(
          sendTo,
          payload,
        );

      this.logger.log(
        `Sent notifications for job ${jobId}: ${notificationResults.success} success, ${notificationResults.failed} failed`,
      );

      try {
        const createdAlertHistoryRows: AlertHistoryTriageCandidate[] = [];
        for (const result of notificationResults.results) {
          const status: AlertStatus =
            result.success || result.partial ? 'sent' : 'failed';
          // One failed insert must not drop the remaining rows or the triage enqueue.
          try {
            // The streak cap counts these rows: without a stored 'sent' row the next failing run alerts again.
            const reservedId = reservedRows.get(result.provider.id);
            const alertRowId = reservedId ?? randomUUID();
            for (let attempt = 1; ; attempt++) {
              try {
                if (reservedId) {
                  await this.dbService.finishJobAlert(
                    reservedId,
                    status,
                    result.error,
                    result.deliveryMetadata,
                  );
                  createdAlertHistoryRows.push({ id: reservedId, status });
                } else {
                  createdAlertHistoryRows.push(
                    await this.dbService.saveAlertHistory(
                      jobId,
                      alertType,
                      result.provider.id,
                      status,
                      payload.message,
                      result.error,
                      job.name,
                      result.deliveryMetadata,
                      alertRowId,
                      runId,
                    ),
                  );
                }
                break;
              } catch (insertError) {
                if (attempt >= ALERT_HISTORY_SAVE_ATTEMPTS) throw insertError;
                await new Promise((resolve) =>
                  setTimeout(resolve, ALERT_HISTORY_RETRY_MS * attempt),
                );
              }
            }
          } catch (rowError) {
            this.logger.error(
              `Failed to save alert history row for job ${jobId}: ${getErrorMessage(rowError)}`,
            );
          }
        }
        await this.sreAlertTriageQueueService.enqueueAlertHistoryRows(
          createdAlertHistoryRows,
        );
      } catch (historyError) {
        this.logger.error(
          `Failed to save alert history for job ${jobId}: ${getErrorMessage(historyError)}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle job notifications for job ${jobId}: ${getErrorMessage(error)}`,
      );
    }
  }
}
