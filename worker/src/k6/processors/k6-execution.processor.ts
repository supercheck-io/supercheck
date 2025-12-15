import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { sql, eq, type SQL } from 'drizzle-orm';
import {
  K6ExecutionService,
  K6ExecutionTask,
} from '../services/k6-execution.service';
import { DbService } from '../../execution/services/db.service';
import { UsageTrackerService } from '../../execution/services/usage-tracker.service';
import { HardStopNotificationService } from '../../execution/services/hard-stop-notification.service';
import { CancellationService } from '../../common/services/cancellation.service';
import * as schema from '../../db/schema';
import { JobNotificationService } from '../../execution/services/job-notification.service';
import { K6_QUEUE } from '../k6.constants';

type K6Task = K6ExecutionTask;

// Utility function to safely get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

abstract class BaseK6ExecutionProcessor extends WorkerHost {
  protected readonly logger: Logger;
  protected readonly workerLocation: string;
  protected readonly enableLocationFiltering: boolean;

  protected constructor(
    processorName: string,
    protected readonly k6ExecutionService: K6ExecutionService,
    protected readonly dbService: DbService,
    protected readonly configService: ConfigService,
    protected readonly jobNotificationService: JobNotificationService,
    protected readonly usageTrackerService: UsageTrackerService,
    protected readonly hardStopNotificationService: HardStopNotificationService,
    protected readonly cancellationService: CancellationService,
  ) {
    super();
    this.logger = new Logger(processorName);

    this.workerLocation = this.configService.get<string>(
      'WORKER_LOCATION',
      'us-east',
    );

    const enableLocationFiltering = this.configService.get<string>(
      'ENABLE_LOCATION_FILTERING',
      'false',
    );

    this.enableLocationFiltering =
      typeof enableLocationFiltering === 'string'
        ? enableLocationFiltering.toLowerCase() === 'true'
        : Boolean(enableLocationFiltering);

    if (this.enableLocationFiltering) {
      this.logger.log(
        `Worker location filtering ENABLED: ${this.workerLocation} (only processing jobs for this location)`,
      );
    } else {
      this.logger.log(
        `Worker location filtering DISABLED: Processing all jobs (location still recorded for reporting)`,
      );
    }
  }

  async handleProcess(
    job: Job<K6Task>,
  ): Promise<{ success: boolean; timedOut?: boolean; error?: string }> {
    const processStartTime = Date.now();
    const requestedLocation = job.data.location || 'us-east';
    const normalizedJobLocation = requestedLocation.toLowerCase();
    const normalizedWorkerLocation = this.workerLocation.toLowerCase();
    const jobLocationIsWildcard = this.isWildcardLocation(
      normalizedJobLocation,
    );
    const workerIsWildcard = this.isWildcardLocation(normalizedWorkerLocation);
    const effectiveJobLocation = jobLocationIsWildcard
      ? this.workerLocation
      : requestedLocation;
    const taskData: K6Task = {
      ...job.data,
      location: effectiveJobLocation,
    };

    const runId = taskData.runId;
    const isJobRun = Boolean(taskData.jobId);
    const testId = taskData.tests?.[0]?.id || taskData.testId || null;

    if (!testId) {
      this.logger.warn(
        `k6 task ${job.id} missing testId; proceeding without linking to a saved test`,
      );
    }

    // Location filtering (multi-region mode)
    // With attempts: 1, we can't rely on retries for location routing
    // Instead, just log and process anyway - the job was already assigned to this queue
    const shouldFilter =
      this.enableLocationFiltering &&
      !workerIsWildcard &&
      !jobLocationIsWildcard &&
      normalizedJobLocation !== normalizedWorkerLocation;

    if (shouldFilter) {
      // Log warning but still process - with attempts: 1, we can't retry
      this.logger.warn(
        `[Job ${job.id}] Location mismatch: job requested ${requestedLocation} but worker is ${this.workerLocation}. Processing anyway to avoid permanent failure.`,
      );
    }

    this.logger.log(
      `[Job ${job.id}] Processing k6 ${isJobRun ? 'job' : 'single test'} from location: ${this.workerLocation}`,
    );

    // Check for cancellation signal before starting execution
    if (await this.cancellationService.isCancelled(runId)) {
      this.logger.warn(
        `[${runId}] K6 execution cancelled before processing (detected in queue)`,
      );

      // Update run status to cancelled
      await this.dbService.db
        .update(schema.runs)
        .set({
          status: 'error',
          completedAt: new Date(),
          errorDetails: 'Execution cancelled by user',
        })
        .where(eq(schema.runs.id, runId));

      // Clear the cancellation signal
      await this.cancellationService.clearCancellationSignal(runId);

      throw new Error('Execution cancelled by user');
    }

    // Check for hard stop before execution (billing limit enforcement)
    const blockCheck = await this.usageTrackerService.shouldBlockExecution(
      taskData.organizationId,
    );
    if (blockCheck.blocked) {
      this.logger.warn(
        `[${runId}] K6 execution blocked by spending limit for org ${taskData.organizationId}`,
      );

      // Update run status to blocked
      await this.dbService.db
        .update(schema.runs)
        .set({
          status: 'blocked',
          completedAt: new Date(),
          errorDetails: blockCheck.reason,
        })
        .where(eq(schema.runs.id, runId));

      // Update job status if this is a job run
      if (taskData.jobId) {
        await this.dbService.db
          .update(schema.jobs)
          .set({ status: 'error', lastRunAt: new Date() })
          .where(eq(schema.jobs.id, taskData.jobId))
          .catch(() => {});
      }

      // Send notification (non-blocking)
      this.hardStopNotificationService
        .notify(
          taskData.organizationId,
          runId,
          blockCheck.reason || 'Spending limit reached',
        )
        .catch(() => {});

      return {
        success: false,
        timedOut: false,
        error: `BILLING_BLOCKED: ${blockCheck.reason}`,
      };
    }

    try {
      // Mark run as in-progress
      await this.dbService.db
        .update(schema.runs)
        .set({
          status: 'running',
          startedAt: new Date(),
          location: effectiveJobLocation as any,
        })
        .where(eq(schema.runs.id, runId));

      // Execute k6
      const result = await this.k6ExecutionService.runK6Test(taskData);

      // Log execution result
      this.logger.log(
        `[${isJobRun ? 'K6 Job' : 'K6 Test'}] ${runId} ${result.success ? 'passed' : 'failed'}`,
      );

      // Extract metrics from summary
      const metrics = this.extractMetrics(result.summary);

      // Check if this was a cancellation (exit code 137 = SIGKILL)
      // The container executor kills the container with SIGKILL when cancellation is detected
      const wasCancelled =
        !result.success &&
        (result.error?.includes('code 137') ||
          result.error?.includes('cancelled'));

      // Create k6_performance_runs record
      const totalRequests = Math.round(metrics.totalRequests || 0);
      const failedRequests = Math.round(metrics.failedRequests || 0);
      const requestRateScaled = Math.round((metrics.requestRate || 0) * 100);
      const avgDurationMs = Math.round(metrics.avgResponseTimeMs || 0);
      const p95DurationMs = Math.round(metrics.p95ResponseTimeMs || 0);
      const p99DurationMs = Math.round(metrics.p99ResponseTimeMs || 0);

      // Determine k6_performance_runs status
      const k6PerformanceStatus = wasCancelled
        ? 'error'
        : result.success
          ? 'passed'
          : 'failed';

      await this.dbService.db.insert(schema.k6PerformanceRuns).values({
        testId,
        runId,
        jobId: taskData.jobId ?? null,
        organizationId: taskData.organizationId,
        projectId: taskData.projectId,
        location: this.workerLocation as any, // Actual execution location
        status: k6PerformanceStatus,
        startedAt: new Date(Date.now() - result.durationMs),
        completedAt: new Date(),
        durationMs: result.durationMs,
        summaryJson: result.summary,
        thresholdsPassed: result.thresholdsPassed,
        totalRequests,
        failedRequests,
        requestRate: requestRateScaled,
        avgResponseTimeMs: avgDurationMs,
        p95ResponseTimeMs: p95DurationMs,
        p99ResponseTimeMs: p99DurationMs,
        vusMax: metrics.maxVUs, // Denormalized for fast dashboard queries
        reportS3Url: result.reportUrl,
        summaryS3Url: result.summaryUrl ?? null,
        consoleS3Url: result.consoleUrl ?? null,
        errorDetails: wasCancelled
          ? 'Cancellation requested by user'
          : result.error,
        consoleOutput: result.consoleOutput
          ? result.consoleOutput.slice(0, 10000)
          : null,
      });

      // Update run with final status and artifacts
      const durationSeconds = Math.max(0, Math.round(result.durationMs / 1000));
      let durationString: string;
      if (durationSeconds <= 0) {
        durationString = '<1s';
      } else if (durationSeconds >= 60) {
        const minutes = Math.floor(durationSeconds / 60);
        const remainder = durationSeconds % 60;
        durationString =
          `${minutes}m${remainder ? ` ${remainder}s` : ''}`.trim();
      } else {
        durationString = `${durationSeconds}s`;
      }

      // Use the wasCancelled check from above (line 163)
      const runStatus: 'passed' | 'failed' | 'error' = wasCancelled
        ? 'error'
        : result.success
          ? 'passed'
          : 'failed';
      const runUpdate: Record<string, any> = {
        status: runStatus,
        completedAt: new Date(),
        durationMs: result.durationMs,
        reportS3Url: result.reportUrl,
        logsS3Url: result.logsUrl ?? null,
      };

      let metadataExpression: SQL | undefined;
      if (result.summary?.runId) {
        metadataExpression = sql`
          jsonb_set(
            coalesce(metadata, '{}'::jsonb),
            '{k6RunId}',
            to_jsonb(${String(result.summary.runId)})
          )
        `;
      }

      if (wasCancelled) {
        runUpdate.errorDetails = 'Cancellation requested by user';
      } else if (result.timedOut) {
        const baseExpression =
          metadataExpression ?? sql`coalesce(metadata, '{}'::jsonb)`;
        metadataExpression = sql`
          jsonb_set(
            ${baseExpression},
            '{timedOut}',
            to_jsonb(true)
          )
        `;
        runUpdate.errorDetails =
          result.error ?? 'k6 execution timed out before completion.';
      } else if (result.error) {
        runUpdate.errorDetails = result.error;
      }

      if (metadataExpression) {
        runUpdate.metadata = metadataExpression;
      }

      await this.dbService.db
        .update(schema.runs)
        .set(runUpdate)
        .where(eq(schema.runs.id, runId));

      // Track K6 usage for billing (even for cancelled runs - they still consumed resources)
      // Use actual duration for cancelled runs, not 0
      const actualDurationMs =
        result.durationMs > 0
          ? result.durationMs
          : Math.max(1000, Date.now() - processStartTime);
      await this.usageTrackerService
        .trackK6Execution(
          taskData.organizationId,
          metrics.maxVUs > 0 ? metrics.maxVUs : 1, // At least 1 VU for cancelled runs
          actualDurationMs,
          {
            runId,
            jobId: taskData.jobId,
            testId,
            location: taskData.location,
          },
        )
        .catch((err: Error) =>
          this.logger.warn(
            `[${runId}] Failed to track K6 usage: ${err.message}`,
          ),
        );

      if (taskData.jobId) {
        const finalStatus = wasCancelled
          ? 'error'
          : result.timedOut
            ? 'failed'
            : result.success
              ? 'passed'
              : 'failed';

        // Update job status based on all current run statuses
        try {
          const finalRunStatuses = await this.dbService.getRunStatusesForJob(
            taskData.jobId,
          );
          const allTerminal = finalRunStatuses.every((s) =>
            ['passed', 'failed', 'error'].includes(s),
          );

          // If only one run or all runs are terminal, set job status to match this run
          if (finalRunStatuses.length === 1 || allTerminal) {
            await this.dbService.updateJobStatus(taskData.jobId, [finalStatus]);
          } else {
            await this.dbService.updateJobStatus(
              taskData.jobId,
              finalRunStatuses,
            );
          }
        } catch (err) {
          this.logger.error(
            `[${runId}] Failed to update job status: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // Update job's lastRunAt timestamp
        await this.dbService.db
          .update(schema.jobs)
          .set({ lastRunAt: new Date() })
          .where(eq(schema.jobs.id, taskData.jobId))
          .catch((err: Error) => {
            this.logger.warn(
              `[${runId}] Failed to update job lastRunAt: ${err.message}`,
            );
          });

        await this.jobNotificationService.handleJobNotifications({
          jobId: taskData.jobId,
          organizationId: taskData.organizationId,
          projectId: taskData.projectId,
          runId,
          finalStatus,
          durationSeconds: Math.round((Date.now() - processStartTime) / 1000),
          results: [{ success: result.success }],
          jobType: taskData.jobType ?? 'k6',
          location: taskData.location ?? null,
          errorMessage: result.timedOut ? result.error : undefined,
        });
      }

      // Note: Telemetry log is emitted inside span context above (line 163-173)

      // Return the success status to BullMQ so queue events are correctly reported
      // Include error field for cancellation detection by queue-event-hub
      return {
        success: result.success,
        timedOut: result.timedOut,
        error: wasCancelled
          ? 'Cancellation requested by user'
          : (result.error ?? undefined),
      };
    } catch (error) {
      const message = `[Job ${job.id}] Failed with error: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.logger.error(
        message,
        error instanceof Error ? error.stack : undefined,
      );

      // Update run record to error status before rethrowing to ensure UI and retries work correctly
      try {
        const durationSeconds = Math.round(
          (Date.now() - processStartTime) / 1000,
        );
        let durationString: string;
        if (durationSeconds <= 0) {
          durationString = '<1s';
        } else if (durationSeconds >= 60) {
          const minutes = Math.floor(durationSeconds / 60);
          const remainder = durationSeconds % 60;
          durationString =
            `${minutes}m${remainder ? ` ${remainder}s` : ''}`.trim();
        } else {
          durationString = `${durationSeconds}s`;
        }

        // Check if this is a cancellation error
        const isCancellation =
          message.includes('cancelled') ||
          message.includes('cancellation') ||
          message.includes('code 137');

        await this.dbService.db
          .update(schema.runs)
          .set({
            status: isCancellation ? 'error' : 'failed',
            completedAt: new Date(),
            durationMs: Date.now() - processStartTime,
            errorDetails: isCancellation
              ? 'Cancellation requested by user'
              : message,
          })
          .where(eq(schema.runs.id, runId));
      } catch (dbError) {
        this.logger.error(
          `[${runId}] Failed to update run to failed status: ${getErrorMessage(dbError)}`,
          dbError instanceof Error ? dbError.stack : undefined,
        );
      }

      if (taskData.jobId) {
        // Update job status based on all current run statuses
        try {
          const finalRunStatuses = await this.dbService.getRunStatusesForJob(
            taskData.jobId,
          );
          const allTerminal = finalRunStatuses.every((s) =>
            ['passed', 'failed', 'error'].includes(s),
          );

          // If only one run or all runs are terminal, set job status to failed
          if (finalRunStatuses.length === 1 || allTerminal) {
            await this.dbService.updateJobStatus(taskData.jobId, ['failed']);
          } else {
            await this.dbService.updateJobStatus(
              taskData.jobId,
              finalRunStatuses,
            );
          }
        } catch (err) {
          this.logger.error(
            `[${runId}] Failed to update job status on error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // Update job's lastRunAt timestamp even on error
        await this.dbService.db
          .update(schema.jobs)
          .set({ lastRunAt: new Date() })
          .where(eq(schema.jobs.id, taskData.jobId))
          .catch((err: Error) => {
            this.logger.warn(
              `[${runId}] Failed to update job lastRunAt on error: ${err.message}`,
            );
          });

        await this.jobNotificationService.handleJobNotifications({
          jobId: taskData.jobId,
          organizationId: taskData.organizationId,
          projectId: taskData.projectId,
          runId,
          finalStatus: 'failed',
          durationSeconds: Math.round((Date.now() - processStartTime) / 1000),
          results: [{ success: false }],
          jobType: taskData.jobType ?? 'k6',
          location: taskData.location ?? null,
          errorMessage: message,
        });
      }

      // Log error
      this.logger.error(
        `[${isJobRun ? 'K6 Job' : 'K6 Test'}] ${runId} crashed`,
        error instanceof Error ? error.stack : undefined,
      );

      // Check if this is a cancellation error (re-check at outer scope)
      const isCancellationOuter =
        message.includes('cancelled') ||
        message.includes('cancellation') ||
        message.includes('code 137');

      // For cancellations, return a result instead of throwing to prevent BullMQ retry
      if (isCancellationOuter) {
        return {
          success: false,
          timedOut: false,
        };
      }

      throw error;
    }
  }

  private extractMetrics(summary: any): {
    totalRequests: number;
    failedRequests: number;
    requestRate: number;
    avgResponseTimeMs: number;
    p95ResponseTimeMs: number;
    p99ResponseTimeMs: number;
    maxVUs: number;
  } {
    if (!summary || !summary.metrics) {
      return {
        totalRequests: 0,
        failedRequests: 0,
        requestRate: 0,
        avgResponseTimeMs: 0,
        p95ResponseTimeMs: 0,
        p99ResponseTimeMs: 0,
        maxVUs: 0,
      };
    }

    const metrics = summary.metrics;
    const httpReqs = metrics['http_reqs'] || {};
    const httpReqDuration = metrics['http_req_duration'] || {};
    const vus = metrics['vus'] || {};
    const vusMax = metrics['vus_max'] || {};

    return {
      totalRequests: httpReqs.count || 0,
      failedRequests: (metrics['checks']?.fails as number) || 0,
      requestRate: httpReqs.rate || 0,
      avgResponseTimeMs: httpReqDuration.avg || 0,
      p95ResponseTimeMs: httpReqDuration['p(95)'] || 0,
      p99ResponseTimeMs: httpReqDuration['p(99)'] || 0,
      maxVUs: vusMax.max || vusMax.value || vus.max || vus.value || 1, // Default to 1 VU if not found
    };
  }

  private formatSummary(summaryJson: any, success: boolean): string {
    if (!summaryJson) {
      return success
        ? 'k6 test completed successfully.'
        : 'k6 test failed with unknown error.';
    }

    try {
      const metrics = summaryJson.metrics || {};
      const httpReqDuration = metrics['http_req_duration'] || {};
      const avg = httpReqDuration.avg || 0;
      const p95 = httpReqDuration['p(95)'] || 0;
      const p99 = httpReqDuration['p(99)'] || 0;

      return `k6 test ${success ? 'passed' : 'failed'}. Avg=${avg.toFixed(
        2,
      )}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms`;
    } catch (error) {
      return success
        ? 'k6 test completed successfully.'
        : 'k6 test failed with unknown error.';
    }
  }

  private isWildcardLocation(location: string): boolean {
    return location === '*' || location === 'any';
  }
}

@Processor(K6_QUEUE, { concurrency: 1 })
export class K6ExecutionProcessor extends BaseK6ExecutionProcessor {
  constructor(
    k6ExecutionService: K6ExecutionService,
    dbService: DbService,
    configService: ConfigService,
    jobNotificationService: JobNotificationService,
    usageTrackerService: UsageTrackerService,
    hardStopNotificationService: HardStopNotificationService,
    cancellationService: CancellationService,
  ) {
    super(
      'K6ExecutionProcessor',
      k6ExecutionService,
      dbService,
      configService,
      jobNotificationService,
      usageTrackerService,
      hardStopNotificationService,
      cancellationService,
    );
  }

  async process(
    job: Job<K6Task>,
  ): Promise<{ success: boolean; timedOut?: boolean }> {
    return await this.handleProcess(job);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, result: unknown) {
    const timedOut = Boolean((result as any)?.timedOut);
    const status = timedOut
      ? 'timed out'
      : (result as any)?.success
        ? 'passed'
        : 'failed';
    this.logger.log(`k6 job ${job.id} completed: ${status}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const jobId = job?.id || 'unknown';
    this.logger.error(
      `[Event:failed] k6 job ${jobId} failed with error: ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error) {
    this.logger.error(
      `[Event:error] k6 worker encountered an error: ${error.message}`,
      error.stack,
    );
  }
}

@Processor('k6-us-east', { concurrency: 1 })
export class K6ExecutionProcessorUS extends K6ExecutionProcessor {
  constructor(
    k6ExecutionService: K6ExecutionService,
    dbService: DbService,
    configService: ConfigService,
    jobNotificationService: JobNotificationService,
    usageTrackerService: UsageTrackerService,
    hardStopNotificationService: HardStopNotificationService,
    cancellationService: CancellationService,
  ) {
    super(
      k6ExecutionService,
      dbService,
      configService,
      jobNotificationService,
      usageTrackerService,
      hardStopNotificationService,
      cancellationService,
    );
    // Override logger name
    (this as any).logger = new Logger('K6ExecutionProcessorUSEast');
  }
}

@Processor('k6-eu-central', { concurrency: 1 })
export class K6ExecutionProcessorEU extends K6ExecutionProcessor {
  constructor(
    k6ExecutionService: K6ExecutionService,
    dbService: DbService,
    configService: ConfigService,
    jobNotificationService: JobNotificationService,
    usageTrackerService: UsageTrackerService,
    hardStopNotificationService: HardStopNotificationService,
    cancellationService: CancellationService,
  ) {
    super(
      k6ExecutionService,
      dbService,
      configService,
      jobNotificationService,
      usageTrackerService,
      hardStopNotificationService,
      cancellationService,
    );
    (this as any).logger = new Logger('K6ExecutionProcessorEUCentral');
  }
}

@Processor('k6-asia-pacific', { concurrency: 1 })
export class K6ExecutionProcessorAPAC extends K6ExecutionProcessor {
  constructor(
    k6ExecutionService: K6ExecutionService,
    dbService: DbService,
    configService: ConfigService,
    jobNotificationService: JobNotificationService,
    usageTrackerService: UsageTrackerService,
    hardStopNotificationService: HardStopNotificationService,
    cancellationService: CancellationService,
  ) {
    super(
      k6ExecutionService,
      dbService,
      configService,
      jobNotificationService,
      usageTrackerService,
      hardStopNotificationService,
      cancellationService,
    );
    (this as any).logger = new Logger('K6ExecutionProcessorAsiaPacific');
  }
}
