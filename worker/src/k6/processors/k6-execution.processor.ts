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
import * as schema from '../../db/schema';
import { JobNotificationService } from '../../execution/services/job-notification.service';
import {
  K6_JOB_EXECUTION_QUEUE,
  K6_TEST_EXECUTION_QUEUE,
} from '../k6.constants';

type K6Task = K6ExecutionTask;

// Utility function to safely get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

class LocationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationMismatchError';
  }
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
  ): Promise<{ success: boolean; timedOut?: boolean }> {
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
    const shouldFilter =
      this.enableLocationFiltering &&
      !workerIsWildcard &&
      !jobLocationIsWildcard &&
      normalizedJobLocation !== normalizedWorkerLocation;

    if (shouldFilter) {
      const message = `[Job ${job.id}] Skipping - job location (${requestedLocation}) doesn't match worker location (${this.workerLocation})`;
      this.logger.debug(message);
      // Throw error to trigger BullMQ's automatic retry mechanism
      // BullMQ will retry this job (attempts: 3, exponential backoff)
      // allowing another worker in the correct region to pick it up
      throw new LocationMismatchError(message);
    }

    this.logger.log(
      `[Job ${job.id}] Processing k6 ${isJobRun ? 'job' : 'single test'} from location: ${this.workerLocation}`,
    );

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

      // Extract metrics from summary
      const metrics = this.extractMetrics(result.summary);

      // Create k6_performance_runs record
      const totalRequests = Math.round(metrics.totalRequests || 0);
      const failedRequests = Math.round(metrics.failedRequests || 0);
      const requestRateScaled = Math.round((metrics.requestRate || 0) * 100);
      const avgDurationMs = Math.round(metrics.avgResponseTimeMs || 0);
      const p95DurationMs = Math.round(metrics.p95ResponseTimeMs || 0);
      const p99DurationMs = Math.round(metrics.p99ResponseTimeMs || 0);

      await this.dbService.db.insert(schema.k6PerformanceRuns).values({
        testId,
        runId,
        jobId: taskData.jobId ?? null,
        organizationId: taskData.organizationId,
        projectId: taskData.projectId,
        location: this.workerLocation as any, // Actual execution location
        status: result.success ? 'passed' : 'failed',
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
        reportS3Url: result.reportUrl,
        summaryS3Url: result.summaryUrl ?? null,
        consoleS3Url: result.consoleUrl ?? null,
        errorDetails: result.error,
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

      const runStatus: 'passed' | 'failed' = result.success
        ? 'passed'
        : 'failed';
      const runUpdate: Record<string, any> = {
        status: runStatus,
        completedAt: new Date(),
        durationMs: result.durationMs,
        duration: durationString,
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

      if (result.timedOut) {
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

      if (taskData.jobId) {
        const finalStatus = result.timedOut
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

      // Return the success status to BullMQ so queue events are correctly reported
      return { success: result.success, timedOut: result.timedOut };
    } catch (error) {
      if (error instanceof LocationMismatchError) {
        // Don't update run status for location mismatches since the job will be retried
        this.logger.warn(error.message);
        throw error;
      }

      const message = `[Job ${job.id}] Failed with error: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.logger.error(
        message,
        error instanceof Error ? error.stack : undefined,
      );

      // Update run record to failed status before rethrowing to ensure UI and retries work correctly
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

        await this.dbService.db
          .update(schema.runs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            durationMs: Date.now() - processStartTime,
            duration: durationString,
            errorDetails: message,
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
  } {
    if (!summary || !summary.metrics) {
      return {
        totalRequests: 0,
        failedRequests: 0,
        requestRate: 0,
        avgResponseTimeMs: 0,
        p95ResponseTimeMs: 0,
        p99ResponseTimeMs: 0,
      };
    }

    const metrics = summary.metrics;
    const httpReqs = metrics['http_reqs'] || {};
    const httpReqDuration = metrics['http_req_duration'] || {};

    return {
      totalRequests: httpReqs.count || 0,
      failedRequests: (metrics['checks']?.fails as number) || 0,
      requestRate: httpReqs.rate || 0,
      avgResponseTimeMs: httpReqDuration.avg || 0,
      p95ResponseTimeMs: httpReqDuration['p(95)'] || 0,
      p99ResponseTimeMs: httpReqDuration['p(99)'] || 0,
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

@Processor(K6_TEST_EXECUTION_QUEUE, { concurrency: 3 })
export class K6TestExecutionProcessor extends BaseK6ExecutionProcessor {
  constructor(
    k6ExecutionService: K6ExecutionService,
    dbService: DbService,
    configService: ConfigService,
    jobNotificationService: JobNotificationService,
  ) {
    super(
      'K6TestExecutionProcessor',
      k6ExecutionService,
      dbService,
      configService,
      jobNotificationService,
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
    this.logger.log(`k6 test ${job.id} completed: ${status}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const jobId = job?.id || 'unknown';
    this.logger.error(
      `[Event:failed] k6 test ${jobId} failed with error: ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error) {
    this.logger.error(
      `[Event:error] k6 test worker encountered an error: ${error.message}`,
      error.stack,
    );
  }
}

@Processor(K6_JOB_EXECUTION_QUEUE, { concurrency: 3 })
export class K6JobExecutionProcessor extends BaseK6ExecutionProcessor {
  constructor(
    k6ExecutionService: K6ExecutionService,
    dbService: DbService,
    configService: ConfigService,
    jobNotificationService: JobNotificationService,
  ) {
    super(
      'K6JobExecutionProcessor',
      k6ExecutionService,
      dbService,
      configService,
      jobNotificationService,
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
      `[Event:error] k6 job worker encountered an error: ${error.message}`,
      error.stack,
    );
  }
}
