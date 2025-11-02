import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, JobsOptions, Queue } from 'bullmq';
import { sql, eq } from 'drizzle-orm';
import {
  K6ExecutionService,
  K6ExecutionTask,
} from '../services/k6-execution.service';
import { DbService } from '../../execution/services/db.service';
import * as schema from '../../db/schema';
import { JobNotificationService } from '../../execution/services/job-notification.service';

// Utility function to safely get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Utility function to safely get error stack
function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

type K6Task = K6ExecutionTask;

class LocationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationMismatchError';
  }
}

@Processor('k6-execution', {
  concurrency: 3, // Process up to 3 k6 tests in parallel
})
export class K6ExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(K6ExecutionProcessor.name);
  private readonly workerLocation: string;
  private readonly enableLocationFiltering: boolean;
  private readonly locationMismatchRetryDelayMs = 1000;

  constructor(
    private k6ExecutionService: K6ExecutionService,
    private dbService: DbService,
    private configService: ConfigService,
    private jobNotificationService: JobNotificationService,
  ) {
    super();

    // Worker location from environment
    this.workerLocation = this.configService.get<string>(
      'WORKER_LOCATION',
      'us-east',
    );

    // Enable location filtering (false for MVP, true for multi-region)
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

  async process(job: Job<K6Task>): Promise<void> {
    const processStartTime = Date.now();
    const requestedLocation = job.data.location || 'us-east';
    const normalizedJobLocation = requestedLocation.toLowerCase();
    const normalizedWorkerLocation = this.workerLocation.toLowerCase();
    const jobLocationIsWildcard = this.isWildcardLocation(normalizedJobLocation);
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
      const [k6Run] = await this.dbService.db
        .insert(schema.k6PerformanceRuns)
        .values({
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
          totalRequests: metrics.totalRequests,
          failedRequests: metrics.failedRequests,
          requestRate: Math.round((metrics.requestRate || 0) * 100),
          avgResponseTimeMs: metrics.avgResponseTimeMs,
          p95ResponseTimeMs: metrics.p95ResponseTimeMs,
          p99ResponseTimeMs: metrics.p99ResponseTimeMs,
          reportS3Url: result.reportUrl,
          summaryS3Url: result.summaryUrl ?? null,
          consoleS3Url: result.consoleUrl ?? null,
          errorDetails: result.error,
          consoleOutput: result.consoleOutput
            ? result.consoleOutput.slice(0, 10000)
            : null,
        })
        .returning();

      // Update run with final status and artifacts
      const durationSeconds = Math.max(0, Math.round(result.durationMs / 1000));
      let durationString: string;
      if (durationSeconds <= 0) {
        durationString = '<1s';
      } else if (durationSeconds >= 60) {
        const minutes = Math.floor(durationSeconds / 60);
        const remainder = durationSeconds % 60;
        durationString = `${minutes}m${remainder ? ` ${remainder}s` : ''}`.trim();
      } else {
        durationString = `${durationSeconds}s`;
      }

      await this.dbService.db
        .update(schema.runs)
        .set({
          status: result.success ? 'passed' : 'failed',
          completedAt: new Date(),
          durationMs: result.durationMs,
          duration: durationString,
          reportS3Url: result.reportUrl,
          logsS3Url: result.logsUrl ?? null,
          metadata: sql`
            jsonb_set(
              coalesce(metadata, '{}'::jsonb),
              '{k6RunId}',
              to_jsonb(${k6Run.id}::text),
              true
            )
          `,
        })
        .where(eq(schema.runs.id, runId));

      await this.dbService.updateRunStatus(
        runId,
        result.success ? 'passed' : 'failed',
        durationString,
      );

      if (taskData.jobId) {
        try {
          const finalRunStatuses =
            await this.dbService.getRunStatusesForJob(taskData.jobId);
          await this.dbService.updateJobStatus(
            taskData.jobId,
            finalRunStatuses,
          );
          await this.dbService.db
            .update(schema.jobs)
            .set({ lastRunAt: new Date() })
            .where(eq(schema.jobs.id, taskData.jobId));
        } catch (statusError) {
          this.logger.error(
            `[Job ${job.id}] Failed to update job status after k6 run: ${getErrorMessage(statusError)}`,
          );
        }
      }

      if (taskData.jobId) {
        await this.jobNotificationService.handleJobNotifications({
          jobId: taskData.jobId,
          organizationId: taskData.organizationId,
          projectId: taskData.projectId,
          runId,
          finalStatus: result.success ? 'passed' : 'failed',
          durationSeconds,
          results: [{ success: result.success }],
          jobType: 'k6',
          location: this.workerLocation,
        });
      }

      this.logger.log(
        `[Job ${job.id}] Completed: ${result.success ? 'PASSED' : 'FAILED'}`,
      );
    } catch (error) {
      this.logger.error(
        `[Job ${job.id}] Failed: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );

      await this.dbService.db
        .update(schema.runs)
        .set({
          status: 'error',
          completedAt: new Date(),
          errorDetails: getErrorMessage(error),
        })
        .where(eq(schema.runs.id, runId));

      if (job.data.jobId) {
        try {
          const finalRunStatuses =
            await this.dbService.getRunStatusesForJob(job.data.jobId);
          await this.dbService.updateJobStatus(
            job.data.jobId,
            finalRunStatuses,
          );
        } catch (statusError) {
          this.logger.error(
            `[Job ${job.id}] Failed to update job status after k6 error: ${getErrorMessage(statusError)}`,
          );
        }
      }

      if (taskData.jobId) {
        const elapsedSeconds = Math.max(
          0,
          Math.round((Date.now() - processStartTime) / 1000),
        );
        try {
          await this.jobNotificationService.handleJobNotifications({
            jobId: taskData.jobId,
            organizationId: taskData.organizationId,
            projectId: taskData.projectId,
            runId,
            finalStatus: 'error',
            durationSeconds: elapsedSeconds,
            results: [{ success: false }],
            jobType: 'k6',
            location: this.workerLocation,
            errorMessage: getErrorMessage(error),
          });
        } catch (notificationError) {
          this.logger.error(
            `[Job ${job.id}] Failed to send error notification: ${getErrorMessage(notificationError)}`,
          );
        }
      }

      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error) {
    if (this.enableLocationFiltering && error instanceof LocationMismatchError) {
      this.logger.debug(
        `Job ${job.id} rescheduled due to location mismatch`,
      );

      try {
        const rescheduleDelay = Math.max(
          job.opts.delay ?? 0,
          this.locationMismatchRetryDelayMs,
        );
        const jobId = job.opts.jobId ?? job.id;
        const {
          attempts,
          backoff,
          removeOnComplete,
          removeOnFail,
          priority,
          lifo,
        } = job.opts;

        const queue = (job as unknown as { queue: Queue | undefined }).queue;
        if (!queue) {
          this.logger.warn(
            `Job ${job.id} missing queue reference; skipping reschedule`,
          );
          await job.remove();
          return;
        }

        const requeueOptions: JobsOptions = {
          jobId,
          delay: rescheduleDelay,
          attempts,
          backoff,
          removeOnComplete,
          removeOnFail,
        };

        if (priority !== undefined) {
          requeueOptions.priority = priority;
        }
        if (lifo !== undefined) {
          requeueOptions.lifo = lifo;
        }

        await job.remove();
        await queue.add(job.name, job.data, requeueOptions);
      } catch (rescheduleError) {
        this.logger.error(
          `Job ${job.id} failed to reschedule after location mismatch: ${getErrorMessage(rescheduleError)}`,
          getErrorStack(rescheduleError),
        );
        try {
          await job.retry();
        } catch (retryError) {
          this.logger.error(
            `Job ${job.id} retry after reschedule failure also failed: ${getErrorMessage(retryError)}`,
            getErrorStack(retryError),
          );
        }
      }

      return;
    }

    this.logger.error(
      `Job ${job.id} failed: ${error.message}`,
      error.stack,
    );
  }

  /**
   * Extract key metrics from k6 summary for database storage
   */
  private extractMetrics(summary: any) {
    if (!summary?.metrics) return {};

    const metrics: any = {};

    // HTTP requests
    const httpReqs =
      summary.metrics.http_reqs?.values ??
      summary.metrics.http_reqs?.value ??
      {};
    if (httpReqs) {
      metrics.totalRequests =
        typeof httpReqs.count === 'number' ? httpReqs.count : 0;
      metrics.requestRate =
        typeof httpReqs.rate === 'number' ? httpReqs.rate : 0;
    }

    // Failed requests
    const httpReqFailed =
      summary.metrics.http_req_failed?.values ??
      summary.metrics.http_req_failed?.value ??
      {};
    if (httpReqFailed) {
      metrics.failedRequests =
        typeof httpReqFailed.fails === 'number' ? httpReqFailed.fails : 0;
    }

    // Response times
    const httpReqDuration =
      summary.metrics.http_req_duration?.values ??
      summary.metrics.http_req_duration?.value ??
      {};
    if (httpReqDuration) {
      metrics.avgResponseTimeMs =
        typeof httpReqDuration.avg === 'number' ? httpReqDuration.avg : 0;
      metrics.p95ResponseTimeMs =
        typeof httpReqDuration['p(95)'] === 'number'
          ? httpReqDuration['p(95)']
          : 0;
      metrics.p99ResponseTimeMs =
        typeof httpReqDuration['p(99)'] === 'number'
          ? httpReqDuration['p(99)']
          : 0;
    }

    return metrics;
  }

  private isWildcardLocation(location?: string | null): boolean {
    if (!location) {
      return false;
    }
    const normalized = location.toLowerCase();
    return normalized === 'local' || normalized === 'any' || normalized === 'all';
  }
}
