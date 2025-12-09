import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PLAYWRIGHT_QUEUE } from '../constants';
import { ExecutionService } from '../services/execution.service';
import { DbService } from '../services/db.service';
import { JobNotificationService } from '../services/job-notification.service';
import { UsageTrackerService } from '../services/usage-tracker.service';
import { HardStopNotificationService } from '../services/hard-stop-notification.service';
import { CancellationService } from '../../common/services/cancellation.service';
import {
  JobExecutionTask,
  TestExecutionTask,
  TestExecutionResult,
  TestResult,
} from '../interfaces';
import { eq } from 'drizzle-orm';
import { jobs } from '../../db/schema';
import { ErrorHandler } from '../../common/utils/error-handler';

@Processor(PLAYWRIGHT_QUEUE, { concurrency: 1 })
export class PlaywrightExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(PlaywrightExecutionProcessor.name);

  constructor(
    private readonly executionService: ExecutionService,
    private readonly dbService: DbService,
    private readonly jobNotificationService: JobNotificationService,
    private readonly usageTrackerService: UsageTrackerService,
    private readonly hardStopNotificationService: HardStopNotificationService,
    private readonly cancellationService: CancellationService,
  ) {
    super();
    this.logger.log(`[Constructor] PlaywrightExecutionProcessor instantiated.`);
  }

  async process(
    job: Job<JobExecutionTask | TestExecutionTask>,
  ): Promise<TestExecutionResult | TestResult> {
    const data = job.data;

    // Determine if this is a test or a job
    if ('testId' in data && !('jobId' in data)) {
      return this.processTest(job as Job<TestExecutionTask>);
    } else {
      return this.processJob(job as Job<JobExecutionTask>);
    }
  }

  private async processTest(job: Job<TestExecutionTask>): Promise<TestResult> {
    const testId = job.data.testId;
    const runId = job.data.runId; // runId is the database run ID for playground tests
    const startTime = new Date();

    try {
      // Check for hard stop before execution (billing limit enforcement)
      if (job.data.organizationId) {
        const blockCheck = await this.usageTrackerService.shouldBlockExecution(
          job.data.organizationId,
        );
        if (blockCheck.blocked) {
          this.logger.warn(
            `[${testId}] Execution blocked by spending limit for org ${job.data.organizationId}`,
          );

          // Update run status to blocked
          if (runId) {
            await this.dbService
              .updateRunStatus(runId, 'blocked', '0', blockCheck.reason)
              .catch((err: Error) =>
                this.logger.error(
                  `[${testId}] Failed to update run status to blocked: ${err.message}`,
                ),
              );
          }

          // Send notification (non-blocking)
          this.hardStopNotificationService
            .notify(
              job.data.organizationId,
              runId || testId,
              blockCheck.reason || 'Spending limit reached',
            )
            .catch(() => {});

          return {
            success: false,
            error: `BILLING_BLOCKED: ${blockCheck.reason}`,
            reportUrl: null,
            testId,
            stdout: '',
            stderr: '',
          };
        }
      }

      await job.updateProgress(10);

      // Delegate the actual execution to the service
      const result = await this.executionService.runSingleTest(job.data);

      await job.updateProgress(100);

      // Check if this was a cancellation
      const isCancellation =
        !result.success &&
        result.error?.includes('Cancellation requested by user');
      const status = isCancellation
        ? 'error'
        : result.success
          ? 'passed'
          : 'failed';
      this.logger.log(`Test ${job.id} completed: ${status}`);

      // Calculate execution duration and track usage
      const endTime = new Date();
      const durationMs =
        result.executionTimeMs ?? endTime.getTime() - startTime.getTime();
      const durationSeconds = Math.floor(durationMs / 1000);

      // Update the runs table status for playground tests (critical for preventing stale runs)
      if (runId) {
        const errorDetails = isCancellation
          ? 'Cancellation requested by user'
          : result.error || undefined;
        await this.dbService
          .updateRunStatus(
            runId,
            status,
            durationSeconds.toString(),
            errorDetails,
          )
          .catch((err: Error) =>
            this.logger.error(
              `[${testId}] Failed to update run status to ${status}: ${err.message}`,
            ),
          );
      }

      // Track Playwright usage for billing (if organizationId is available)
      if (job.data.organizationId) {
        await this.usageTrackerService
          .trackPlaywrightExecution(job.data.organizationId, durationMs, {
            testId,
            runId,
            type: 'single_test',
          })
          .catch((err: Error) =>
            this.logger.warn(
              `[${testId}] Failed to track Playwright usage: ${err.message}`,
            ),
          );
      }

      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;
      const isCancellation =
        errorMessage.includes('cancelled') ||
        errorMessage.includes('cancellation') ||
        errorMessage.includes('code 137');

      this.logger.error(
        `[${testId}] Test execution job ID: ${job.id} failed. Error: ${errorMessage}`,
        (error as Error).stack,
      );
      await job.updateProgress(100);

      // Update the runs table status for playground tests on error
      if (runId) {
        const errorStatus = isCancellation ? 'error' : 'failed';
        const errorDetails = isCancellation
          ? 'Cancellation requested by user'
          : errorMessage;
        await this.dbService
          .updateRunStatus(runId, errorStatus, '0', errorDetails)
          .catch((err: Error) =>
            this.logger.error(
              `[${testId}] Failed to update run error status: ${err.message}`,
            ),
          );
      }

      // For cancellations, return a result instead of throwing to prevent BullMQ retry
      if (isCancellation) {
        return {
          success: false,
          error: 'Cancellation requested by user',
          reportUrl: null,
          testId,
          stdout: '',
          stderr: '',
        };
      }

      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private async processJob(
    job: Job<JobExecutionTask>,
  ): Promise<TestExecutionResult> {
    const runId = job.data.runId;
    const jobData = job.data;
    const { jobId: originalJobId } = jobData;
    const jobIdForLookup = jobData.originalJobId || jobData.jobId;
    const startTime = new Date();

    this.logger.log(
      `[${runId}] Job execution job ID: ${job.id} received for processing${originalJobId ? ` (job ${originalJobId})` : ''}`,
    );

    // Check for cancellation signal before starting execution
    if (await this.cancellationService.isCancelled(runId)) {
      this.logger.warn(
        `[${runId}] Job execution cancelled before processing (detected in queue)`,
      );

      // Update run status to cancelled
      await this.dbService
        .updateRunStatus(runId, 'error', '0')
        .catch((err: Error) =>
          this.logger.error(
            `[${runId}] Failed to update run status to cancelled: ${err.message}`,
          ),
        );

      // Clear the cancellation signal
      await this.cancellationService.clearCancellationSignal(runId);

      throw new Error('Execution cancelled by user');
    }

    // Check for hard stop before execution (billing limit enforcement)
    const blockCheck = await this.usageTrackerService.shouldBlockExecution(
      jobData.organizationId,
    );
    if (blockCheck.blocked) {
      this.logger.warn(
        `[${runId}] Job execution blocked by spending limit for org ${jobData.organizationId}`,
      );

      // Update run status to blocked
      await this.dbService
        .updateRunStatus(runId, 'blocked', '0', blockCheck.reason)
        .catch((err: Error) =>
          this.logger.error(
            `[${runId}] Failed to update run status to blocked: ${err.message}`,
          ),
        );

      // Update job status
      if (originalJobId) {
        await this.updateJobStatus(originalJobId, 'error', runId);
      }

      // Send notification (non-blocking)
      this.hardStopNotificationService
        .notify(
          jobData.organizationId,
          runId,
          blockCheck.reason || 'Spending limit reached',
        )
        .catch(() => {});

      return {
        jobId: runId,
        success: false,
        error: `BILLING_BLOCKED: ${blockCheck.reason}`,
        reportUrl: null,
        results: [],
        timestamp: new Date().toISOString(),
        stdout: '',
        stderr: '',
      };
    }

    await job.updateProgress(10);

    try {
      // Delegate the actual execution to the service
      const result = await this.executionService.runJob(job.data);

      await job.updateProgress(100);
      this.logger.log(
        `[${runId}] Job execution job ID: ${job.id} completed. Overall Success: ${result.success}`,
      );

      // Calculate execution duration
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationSeconds = Math.floor(durationMs / 1000);

      // Check if execution service already set error status (for cancellations)
      // Don't override 'error' status with 'failed'
      let finalStatus: 'passed' | 'failed' | 'error';
      if (
        !result.success &&
        result.error?.includes('Cancellation requested by user')
      ) {
        // Execution was cancelled, keep 'error' status
        finalStatus = 'error';
      } else {
        // Normal completion
        finalStatus = result.success ? 'passed' : 'failed';
      }

      // Update the run status with duration first
      await this.dbService
        .updateRunStatus(runId, finalStatus, durationSeconds.toString())
        .catch((err: Error) =>
          this.logger.error(
            `[${runId}] Failed to update run status to ${finalStatus}: ${err.message}`,
          ),
        );

      // Track Playwright usage for billing
      await this.usageTrackerService
        .trackPlaywrightExecution(jobData.organizationId, durationMs, {
          runId,
          jobId: originalJobId,
          testCount: result.results?.length || 0,
        })
        .catch((err: Error) =>
          this.logger.warn(
            `[${runId}] Failed to track Playwright usage: ${err.message}`,
          ),
        );

      // Update job status based on all current run statuses
      if (originalJobId) {
        await this.updateJobStatus(originalJobId, finalStatus, runId);

        // Always update lastRunAt after a run completes
        await this.dbService.db
          .update(jobs)
          .set({ lastRunAt: new Date() })
          .where(eq(jobs.id, originalJobId))
          .execute();
      }

      // Send notifications for job completion
      await this.jobNotificationService.handleJobNotifications({
        jobId: jobIdForLookup,
        organizationId: jobData.organizationId,
        projectId: jobData.projectId,
        runId,
        finalStatus,
        durationSeconds,
        results: result.results ?? [],
        jobType: jobData.jobType ?? 'playwright',
      });

      return result;
    } catch (error: unknown) {
      ErrorHandler.logError(
        this.logger,
        error,
        `Job execution ${runId} (job ID: ${job.id})`,
        { runId, jobId: job.id },
      );

      // Check if this is a cancellation error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isCancellation =
        errorMessage.includes('cancelled') ||
        errorMessage.includes('cancellation') ||
        errorMessage.includes('code 137');

      // Update database with error status
      const errorStatus = isCancellation ? 'error' : 'failed';
      const errorDetails = isCancellation
        ? 'Cancellation requested by user'
        : errorMessage;

      // Update run status first
      await this.dbService
        .updateRunStatus(runId, errorStatus, '0', errorDetails)
        .catch((err: Error) =>
          this.logger.error(
            `[${runId}] Failed to update run error status: ${err.message}`,
          ),
        );

      // Update job status based on all current run statuses
      if (originalJobId) {
        await this.updateJobStatus(originalJobId, errorStatus, runId);
      }

      try {
        const elapsedSeconds = Math.max(
          0,
          Math.floor((new Date().getTime() - startTime.getTime()) / 1000),
        );
        await this.jobNotificationService.handleJobNotifications({
          jobId: jobIdForLookup,
          organizationId: jobData.organizationId,
          projectId: jobData.projectId,
          runId,
          finalStatus: 'error',
          durationSeconds: elapsedSeconds,
          results: [{ success: false }],
          jobType: jobData.jobType ?? 'playwright',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } catch (notificationError) {
        this.logger.error(
          `[${runId}] Failed to send error notification: ${
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError)
          }`,
        );
      }

      await job.updateProgress(100);

      // For cancellations, return a result instead of throwing to prevent BullMQ retry
      if (isCancellation) {
        return {
          jobId: runId,
          success: false,
          error: 'Cancellation requested by user',
          reportUrl: null,
          results: [],
          timestamp: new Date().toISOString(),
          stdout: '',
          stderr: '',
        };
      }

      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private async updateJobStatus(
    originalJobId: string,
    status: 'pending' | 'running' | 'passed' | 'failed' | 'error',
    runId: string,
  ) {
    const finalRunStatuses =
      await this.dbService.getRunStatusesForJob(originalJobId);
    // Robust: If only one run, or all runs are terminal, set job status to match this run
    const allTerminal = finalRunStatuses.every((s) =>
      ['passed', 'failed', 'error'].includes(s),
    );
    if (finalRunStatuses.length === 1 || allTerminal) {
      await this.dbService
        .updateJobStatus(originalJobId, [status])
        .catch((err: Error) =>
          this.logger.error(
            `[${runId}] Failed to update job status (robust): ${err.message}`,
          ),
        );
    } else {
      await this.dbService
        .updateJobStatus(originalJobId, finalRunStatuses)
        .catch((err: Error) =>
          this.logger.error(
            `[${runId}] Failed to update job status: ${err.message}`,
          ),
        );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const jobId = job?.id || 'unknown';
    this.logger.error(
      `[Event:failed] Job ${jobId} failed with error: ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error) {
    this.logger.error(
      `[Event:error] Worker encountered an error: ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('ready')
  onReady() {
    this.logger.log(
      '[Event:ready] Worker is connected to Redis and ready to process jobs.',
    );
  }
}
