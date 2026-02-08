import { Injectable, Logger } from '@nestjs/common';
import { AlertStatus, AlertType, TestRunStatus } from '../../db/schema';
import { DbService } from './db.service';
import {
  NotificationPayload,
  NotificationService,
} from '../../notification/notification.service';

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
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

@Injectable()
export class JobNotificationService {
  private readonly logger = new Logger(JobNotificationService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly notificationService: NotificationService,
  ) {}

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
  }: JobNotificationParams): Promise<void> {
    try {
      if (!jobId) {
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
        Math.max(alertConfig.failureThreshold, alertConfig.recoveryThreshold),
      );

      const normalizedStatus = finalStatus === 'error' ? 'failed' : finalStatus;

      let consecutiveFailures = normalizedStatus === 'failed' ? 1 : 0;
      let consecutiveSuccesses = normalizedStatus === 'passed' ? 1 : 0;

      for (const run of recentRuns) {
        if (normalizedStatus === 'failed') {
          if (run.status === 'failed' || run.status === 'error') {
            consecutiveFailures++;
            continue;
          }
          break;
        }

        if (normalizedStatus === 'passed') {
          if (run.status === 'passed') {
            consecutiveSuccesses++;
            continue;
          }
          break;
        }
      }

      const shouldNotifyFailure =
        alertConfig.alertOnFailure &&
        normalizedStatus === 'failed' &&
        consecutiveFailures >= alertConfig.failureThreshold;

      const shouldNotifySuccess =
        alertConfig.alertOnSuccess &&
        normalizedStatus === 'passed' &&
        consecutiveSuccesses >= alertConfig.recoveryThreshold;

      const shouldNotifyTimeout =
        alertConfig.alertOnTimeout && finalStatus === 'timeout';

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
        message = `Job "${job.name}" timed out after ${safeDuration} seconds. No ping received within expected interval.`;
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
          status: normalizedStatus,
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

      const notificationResults =
        await this.notificationService.sendNotificationToMultipleProviders(
          providers,
          payload,
        );

      this.logger.log(
        `Sent notifications for job ${jobId}: ${notificationResults.success} success, ${notificationResults.failed} failed`,
      );

      try {
        for (const result of notificationResults.results) {
          const status: AlertStatus = result.success ? 'sent' : 'failed';
          await this.dbService.saveAlertHistory(
            jobId,
            alertType,
            result.provider.id,
            status,
            payload.message,
            result.error,
            job.name,
          );
        }
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
