import { ExecutionCapacityError } from '../services/execution-admission.service';
import { deferForCapacity } from '../../common/capacity-deferral';
import {
  withRunCallback,
  RunCallbackBusyError,
} from '../services/run-callback';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, UnrecoverableError, DelayedError } from 'bullmq';
import {
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PLAYWRIGHT_QUEUE } from '../constants';
import { ExecutionService } from '../services/execution.service';
import { DbService } from '../services/db.service';
import { JobNotificationService } from '../services/job-notification.service';
import { UsageTrackerService } from '../services/usage-tracker.service';
import { HardStopNotificationService } from '../services/hard-stop-notification.service';
import {
  CancellationService,
  RUN_CANCELLATION_MARKER,
} from '../../common/services/cancellation.service';
import {
  JobExecutionTask,
  TestExecutionTask,
  TestExecutionResult,
  TestResult,
} from '../interfaces';
import { eq } from 'drizzle-orm';
import { jobs } from '../../db/schema';
import { ErrorHandler } from '../../common/utils/error-handler';
import { getBillableMs } from '../../common/billable-ms';
import { consumesWorkerQueue } from '../../common/worker-queues';
import { GlobalQueueCapabilityGuard } from '../../common/location/global-queue-guard';
import type { ExecutionUsageTransaction } from '../services/execution-usage-receipts';
import { captureJobFailure } from '../../common/sentry-reporter';

@Processor(PLAYWRIGHT_QUEUE, {
  concurrency: 1,
  lockDuration: 70 * 60 * 1000,
  stalledInterval: 30000,
  maxStalledCount: 2,
  metrics: { maxDataPoints: 60 },
  // Workers that don't consume the global Playwright queue (WORKER_QUEUES) build
  // the consumer idle: ExecutionService stays available for synthetic monitors.
  autorun: consumesWorkerQueue('global-playwright'),
})
export class PlaywrightExecutionProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PlaywrightExecutionProcessor.name);
  private capabilityGuard: GlobalQueueCapabilityGuard | null = null;

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

  onApplicationBootstrap(): void {
    // Only the global consumer needs guarding; idle consumers never run.
    if (!consumesWorkerQueue('global-playwright')) return;
    this.capabilityGuard = new GlobalQueueCapabilityGuard(
      () => this.worker,
      this.dbService,
      process.env.WORKER_LOCATION || 'local',
      'browser',
      this.logger,
    );
    this.capabilityGuard.start();
  }

  onModuleDestroy(): void {
    this.capabilityGuard?.stop();
  }

  async process(
    job: Job<JobExecutionTask | TestExecutionTask>,
  ): Promise<TestExecutionResult | TestResult> {
    try {
      return await withRunCallback(this.dbService.db, job.data.runId, () =>
        this.processOwned(job),
      );
    } catch (error) {
      if (error instanceof RunCallbackBusyError) {
        await job.moveToDelayed(Date.now() + 10_000, job.token);
        throw new DelayedError();
      }
      throw error;
    }
  }

  private async processOwned(
    job: Job<JobExecutionTask | TestExecutionTask>,
  ): Promise<TestExecutionResult | TestResult> {
    const data = job.data;
    let terminal = data.runId
      ? await this.dbService.getTerminalRun(data.runId)
      : undefined;
    if (!terminal && data.runId) {
      if (await this.hasActiveExecutionOrFail(data.runId)) {
        await job.moveToDelayed(Date.now() + 10_000, job.token);
        throw new DelayedError();
      }
      if (!(await this.dbService.claimRunExecution(data.runId))) {
        // Refused because cancellation was requested, or because the run already finished (a replay of a terminal run);
        // either way nothing is running, so end the run here (finalizing is a no-op if it is already terminal).
        await this.dbService.finalizeCancelledRun(data.runId);
        terminal = {
          id: data.runId,
          status: 'error',
          errorDetails: RUN_CANCELLATION_MARKER,
        };
      }
    }
    if (terminal) {
      const outcome = {
        success: terminal.status === 'passed',
        error: terminal.errorDetails,
        reportUrl: null,
      };
      return 'testId' in data && !('jobId' in data)
        ? { ...outcome, testId: data.testId, stdout: '', stderr: '' }
        : {
            ...outcome,
            jobId: (data as JobExecutionTask).jobId,
            results: [],
            timestamp: new Date().toISOString(),
          };
    }

    // Determine if this is a test or a job
    if ('testId' in data && !('jobId' in data)) {
      return this.processTest(job as Job<TestExecutionTask>);
    } else {
      return this.processJob(job as Job<JobExecutionTask>);
    }
  }

  /** Records why a run was never started after its organization's slot stayed occupied. */
  private async failRunAfterCapacityWait(
    runId: string | null | undefined,
    reason: string,
  ): Promise<void> {
    if (!runId) return;
    // A run the user already cancelled ends as cancelled; the capacity failure must not replace that.
    await this.dbService
      .failRunUnlessCancelled(runId, reason)
      .catch((err: Error) =>
        this.logger.error(
          `[${runId}] Failed to mark run failed after waiting for capacity: ${err.message}`,
        ),
      );
  }

  /**
   * Whether a live execution exists for the run. If Kubernetes stays
   * unreachable past the bounded wait, fail the run terminally (no retry, no
   * usage) so it cannot sit queued forever with no sweeper looking at it.
   */
  private async hasActiveExecutionOrFail(runId: string): Promise<boolean> {
    try {
      return await this.executionService.hasActiveExecution(runId, {
        boundUncertainty: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const recorded = await this.dbService
        .failRunUnlessCancelled(runId, message)
        .then(
          () => true,
          (err: Error) => {
            this.logger.error(
              `[${runId}] Failed to mark run failed after unverifiable execution state: ${err.message}`,
            );
            return false;
          },
        );
      // Nothing claimed the run yet, so retry rather than give up with the failure unrecorded.
      throw recorded ? new UnrecoverableError(message) : new Error(message);
    }
  }

  private async processTest(job: Job<TestExecutionTask>): Promise<TestResult> {
    const testId = job.data.testId;
    const runId = job.data.runId; // runId is the database run ID for playground tests
    const startTime = new Date();
    let usagePersisted = false;
    let observedBillableMs = 0;

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
      observedBillableMs = result.billableMs ?? 0;

      await job
        .updateProgress(100)
        .catch((error: unknown) =>
          this.logger.warn(
            `Unable to publish completion progress: ${String(error)}`,
          ),
        );

      // Check if this was a cancellation
      const isCancellation =
        !result.success && result.error?.includes(RUN_CANCELLATION_MARKER);
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
      // Meter only container run time evidenced by Kubernetes.
      const billableMs = result.billableMs ?? 0;

      // Update the runs table status for playground tests (critical for preventing stale runs)
      if (runId) {
        const errorDetails = isCancellation
          ? RUN_CANCELLATION_MARKER
          : result.error || undefined;
        const persistResult = async (transaction?: ExecutionUsageTransaction) =>
          this.dbService.updateRunStatus(
            runId,
            status,
            durationSeconds.toString(),
            errorDetails,
            transaction,
          );
        if (job.data.organizationId) {
          await this.usageTrackerService.completeRunWithUsage(
            {
              organizationId: job.data.organizationId,
              runId,
              durationMs: billableMs,
              eventType: 'playwright_execution',
              metadata: { testId, type: 'single_test' },
            },
            persistResult,
          );
        } else {
          await persistResult();
        }
      }

      usagePersisted = true;

      // Track Playwright usage for billing (if organizationId is available)
      if (job.data.organizationId && billableMs > 0) {
        await this.usageTrackerService
          .trackPlaywrightExecution(job.data.organizationId, billableMs, {
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
      if (error instanceof ExecutionCapacityError) {
        return deferForCapacity(job, (reason) =>
          this.failRunAfterCapacityWait(runId, reason),
        );
      }
      const errorMessage = (error as Error).message;
      const isCancellation =
        errorMessage.includes('cancelled') ||
        errorMessage.includes('cancellation');
      if (
        !isCancellation &&
        !(error instanceof UnrecoverableError) &&
        (job.attemptsMade ?? 0) + 1 < (job.opts?.attempts ?? 1)
      ) {
        if (
          Math.max(getBillableMs(error), observedBillableMs) > 0 &&
          !usagePersisted &&
          job.data.organizationId &&
          runId
        ) {
          await this.usageTrackerService.completeRunWithUsage(
            {
              organizationId: job.data.organizationId,
              runId: `${runId}:attempt:${job.attemptsMade ?? 0}`,
              eventType: 'playwright_execution',
              durationMs: Math.max(getBillableMs(error), observedBillableMs),
              metadata: {
                executionRunId: runId,
                retryAttempt: job.attemptsMade ?? 0,
              },
            },
            async () => {},
          );
        }
        throw error;
      }

      this.logger.error(
        `[${testId}] Test execution job ID: ${job.id} failed. Error: ${errorMessage}`,
        (error as Error).stack,
      );
      await job
        .updateProgress(100)
        .catch((error: unknown) =>
          this.logger.warn(
            `Unable to publish completion progress: ${String(error)}`,
          ),
        );

      // Update the runs table status for playground tests on error
      if (runId) {
        const errorStatus = isCancellation ? 'error' : 'failed';
        const errorDetails = isCancellation
          ? RUN_CANCELLATION_MARKER
          : errorMessage;
        await (
          job.data.organizationId &&
          Math.max(getBillableMs(error), observedBillableMs) > 0 &&
          !usagePersisted
            ? this.usageTrackerService.completeRunWithUsage(
                {
                  organizationId: job.data.organizationId,
                  runId,
                  durationMs: Math.max(
                    getBillableMs(error),
                    observedBillableMs,
                  ),
                  eventType: 'playwright_execution',
                  metadata: {
                    testId,
                    type: 'single_test',
                    executionError: true,
                  },
                },
                (transaction) =>
                  this.dbService.updateRunStatus(
                    runId,
                    errorStatus,
                    String(
                      Math.floor(
                        Math.max(getBillableMs(error), observedBillableMs) /
                          1000,
                      ),
                    ),
                    errorDetails,
                    transaction,
                  ),
              )
            : this.dbService.updateRunStatus(
                runId,
                errorStatus,
                '0',
                errorDetails,
              )
        ).catch((err: Error) =>
          this.logger.error(
            `[${testId}] Failed to update run error status: ${err.message}`,
          ),
        );
      }

      // For cancellations, return a result instead of throwing to prevent BullMQ retry
      if (isCancellation) {
        return {
          success: false,
          error: RUN_CANCELLATION_MARKER,
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
    let usagePersisted = false;
    let observedBillableMs = 0;

    this.logger.log(
      `[${runId}] Job execution job ID: ${job.id} received for processing${originalJobId ? ` (job ${originalJobId})` : ''}`,
    );

    // Check for cancellation signal before starting execution
    if (await this.cancellationService.isCancelled(runId)) {
      this.logger.warn(
        `[${runId}] Job execution cancelled before processing (detected in queue)`,
      );

      // Update run status to cancelled
      const runCancellationRecorded = await this.dbService
        .updateRunStatus(runId, 'error', '0', RUN_CANCELLATION_MARKER)
        .then(() => true)
        .catch((err: Error) => {
          this.logger.error(
            `[${runId}] Failed to update run status to cancelled: ${err.message}`,
          );
          return false;
        });

      // The stalled-run sweep finalizes the run and its job together if this write failed.
      if (originalJobId && runCancellationRecorded) {
        await this.updateJobStatus(originalJobId, 'error', runId);
        await this.dbService.db
          .update(jobs)
          .set({ lastRunAt: new Date() })
          .where(eq(jobs.id, originalJobId))
          .execute();
      }

      return {
        jobId: originalJobId || jobData.jobId,
        success: false,
        error: RUN_CANCELLATION_MARKER,
        reportUrl: null,
        results: jobData.testScripts.map((test) => ({
          testId: test.id,
          success: false,
          error: RUN_CANCELLATION_MARKER,
          reportUrl: null,
        })),
        timestamp: new Date().toISOString(),
        totalTests: jobData.testScripts.length,
        passedTests: 0,
        failedTests: jobData.testScripts.length,
      };
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
      observedBillableMs = result.billableMs ?? 0;

      await job
        .updateProgress(100)
        .catch((error: unknown) =>
          this.logger.warn(
            `Unable to publish completion progress: ${String(error)}`,
          ),
        );
      this.logger.log(
        `[${runId}] Job execution job ID: ${job.id} completed. Overall Success: ${result.success}`,
      );

      // Calculate execution duration
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationSeconds = Math.floor(durationMs / 1000);
      // Meter only container run time evidenced by Kubernetes.
      const billableMs = result.billableMs ?? 0;

      // Check if execution service already set error status (for cancellations)
      // Don't override 'error' status with 'failed'
      let finalStatus: 'passed' | 'failed' | 'error';
      if (!result.success && result.error?.includes(RUN_CANCELLATION_MARKER)) {
        // Execution was cancelled, keep 'error' status
        finalStatus = 'error';
      } else {
        // Normal completion
        finalStatus = result.success ? 'passed' : 'failed';
      }

      // Update the run status with duration first
      await this.usageTrackerService.completeRunWithUsage(
        {
          organizationId: jobData.organizationId,
          runId,
          durationMs: billableMs,
          eventType: 'playwright_execution',
          metadata: {
            jobId: originalJobId,
            testCount: result.results?.length || 0,
          },
        },
        async (transaction) =>
          this.dbService.updateRunStatus(
            runId,
            finalStatus,
            durationSeconds.toString(),
            result.error || undefined,
            transaction,
          ),
      );

      usagePersisted = true;

      // Track Playwright usage for billing (only when a container actually ran)
      if (billableMs > 0) {
        await this.usageTrackerService
          .trackPlaywrightExecution(jobData.organizationId, billableMs, {
            runId,
            jobId: originalJobId,
            testCount: result.results?.length || 0,
          })
          .catch((err: Error) =>
            this.logger.warn(
              `[${runId}] Failed to track Playwright usage: ${err.message}`,
            ),
          );
      }

      usagePersisted = true;

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
        cancelled:
          !result.success && !!result.error?.includes(RUN_CANCELLATION_MARKER),
        durationSeconds,
        results: result.results ?? [],
        jobType: jobData.jobType ?? 'playwright',
      });

      return result;
    } catch (error: unknown) {
      if (error instanceof ExecutionCapacityError) {
        return deferForCapacity(job, (reason) =>
          this.failRunAfterCapacityWait(runId, reason),
        );
      }
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
        errorMessage.includes('cancellation');
      if (
        !isCancellation &&
        !(error instanceof UnrecoverableError) &&
        (job.attemptsMade ?? 0) + 1 < (job.opts?.attempts ?? 1)
      ) {
        if (
          Math.max(getBillableMs(error), observedBillableMs) > 0 &&
          !usagePersisted &&
          job.data.organizationId &&
          runId
        ) {
          await this.usageTrackerService.completeRunWithUsage(
            {
              organizationId: job.data.organizationId,
              runId: `${runId}:attempt:${job.attemptsMade ?? 0}`,
              eventType: 'playwright_execution',
              durationMs: Math.max(getBillableMs(error), observedBillableMs),
              metadata: {
                executionRunId: runId,
                retryAttempt: job.attemptsMade ?? 0,
              },
            },
            async () => {},
          );
        }
        throw error;
      }

      // Update database with error status
      const errorStatus = isCancellation ? 'error' : 'failed';
      const errorDetails = isCancellation
        ? RUN_CANCELLATION_MARKER
        : errorMessage;

      // Update run status first
      await (
        jobData.organizationId &&
        Math.max(getBillableMs(error), observedBillableMs) > 0 &&
        !usagePersisted
          ? this.usageTrackerService.completeRunWithUsage(
              {
                organizationId: jobData.organizationId,
                runId,
                durationMs: Math.max(getBillableMs(error), observedBillableMs),
                eventType: 'playwright_execution',
                metadata: { jobId: jobIdForLookup, executionError: true },
              },
              (transaction) =>
                this.dbService.updateRunStatus(
                  runId,
                  errorStatus,
                  String(
                    Math.floor(
                      Math.max(getBillableMs(error), observedBillableMs) / 1000,
                    ),
                  ),
                  errorDetails,
                  transaction,
                ),
            )
          : this.dbService.updateRunStatus(
              runId,
              errorStatus,
              '0',
              errorDetails,
            )
      ).catch((err: Error) =>
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
          cancelled: isCancellation,
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

      await job
        .updateProgress(100)
        .catch((error: unknown) =>
          this.logger.warn(
            `Unable to publish completion progress: ${String(error)}`,
          ),
        );

      // For cancellations, return a result instead of throwing to prevent BullMQ retry
      if (isCancellation) {
        return {
          jobId: runId,
          success: false,
          error: RUN_CANCELLATION_MARKER,
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
    // Job status follows this run's final status; only a sibling still queued/running keeps it running.
    try {
      const otherActive = await this.dbService.hasOtherActiveRun(
        originalJobId,
        runId,
      );
      await this.dbService.updateJobStatus(originalJobId, [
        otherActive ? 'running' : status,
      ]);
    } catch (err) {
      // A failed sibling lookup is "unknown", not "none active": skip the write instead of guessing.
      this.logger.error(
        `[${runId}] Failed to update job status: ${err instanceof Error ? err.message : String(err)}`,
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
    captureJobFailure(job, error);
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
