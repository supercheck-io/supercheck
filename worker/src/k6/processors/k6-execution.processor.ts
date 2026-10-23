import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import {
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError, DelayedError } from 'bullmq';
import { sql, eq, and, type SQL, inArray } from 'drizzle-orm';
import {
  K6ExecutionService,
  K6ExecutionTask,
} from '../services/k6-execution.service';
import { DbService } from '../../execution/services/db.service';
import { UsageTrackerService } from '../../execution/services/usage-tracker.service';
import { HardStopNotificationService } from '../../execution/services/hard-stop-notification.service';
import {
  CancellationService,
  RUN_CANCELLATION_MARKER,
} from '../../common/services/cancellation.service';
import {
  getBillableMs,
  getBillableVirtualUsers,
} from '../../common/billable-ms';
import * as schema from '../../db/schema';
import { JobNotificationService } from '../../execution/services/job-notification.service';
import { K6_QUEUE } from '../k6.constants';
import { consumesWorkerQueue } from '../../common/worker-queues';
import { locationSupportsWorkload } from '../../common/location/location-capability';
import { GlobalQueueCapabilityGuard } from '../../common/location/global-queue-guard';

type K6Task = K6ExecutionTask;

// Utility function to safely get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function getFailedHttpRequestCount(
  metrics: Record<string, Record<string, number>>,
): number {
  const httpReqs = metrics.http_reqs || {};
  const httpReqFailed = metrics.http_req_failed || {};
  const totalRequests = httpReqs.count || 0;
  return (
    httpReqFailed.passes ??
    (typeof httpReqFailed.rate === 'number'
      ? httpReqFailed.rate * totalRequests
      : 0)
  );
}

abstract class BaseK6ExecutionProcessor extends WorkerHost {
  protected readonly logger: Logger;
  protected readonly workerLocation: string;

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

    // Worker location is used for logging and reporting
    // Queue routing is handled at module level by conditional queue registration
    this.workerLocation = this.configService.get<string>(
      'WORKER_LOCATION',
      'local',
    );

    this.logger.log(
      `K6 processor initialized for location: ${this.workerLocation}`,
    );
  }

  /**
   * Whether a live execution exists for the run. If Kubernetes stays
   * unreachable past the bounded wait, fail the run terminally (no retry, no
   * usage) so it cannot sit queued forever with no sweeper looking at it.
   */
  private async hasActiveExecutionOrFail(runId: string): Promise<boolean> {
    try {
      return await this.k6ExecutionService.hasActiveExecution(runId, {
        boundUncertainty: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.dbService.db
        .update(schema.runs)
        .set({
          status: 'failed',
          completedAt: new Date(),
          errorDetails: message,
        })
        .where(
          and(
            eq(schema.runs.id, runId),
            inArray(schema.runs.status, ['queued', 'running']),
          ),
        )
        .catch((err: Error) =>
          this.logger.error(
            `[${runId}] Failed to mark run failed after unverifiable execution state: ${err.message}`,
          ),
        );
      throw new UnrecoverableError(message);
    }
  }

  async handleProcess(
    job: Job<K6Task>,
  ): Promise<{ success: boolean; timedOut?: boolean; error?: string }> {
    const processStartTime = Date.now();
    let observedBillableMs = 0;
    let observedVirtualUsers: number | undefined;
    let usagePersisted = false;
    const requestedLocation = job.data.location || this.workerLocation;
    const normalizedJobLocation = requestedLocation.toLowerCase();
    const jobLocationIsWildcard = this.isWildcardLocation(
      normalizedJobLocation,
    );

    // If job location is wildcard (*, any), use worker's actual location for reporting
    const effectiveJobLocation = jobLocationIsWildcard
      ? this.workerLocation
      : requestedLocation;
    const taskData: K6Task = {
      ...job.data,
      location: effectiveJobLocation,
    };

    const runId = taskData.runId;
    const terminal = await this.dbService.getTerminalRun(runId);
    if (terminal)
      return {
        success: terminal.status === 'passed',
        error: terminal.errorDetails ?? undefined,
      };
    if (await this.hasActiveExecutionOrFail(runId)) {
      await job.moveToDelayed(Date.now() + 10_000, job.token);
      throw new DelayedError();
    }
    if (!(await this.dbService.claimRunExecution(runId))) {
      // Refused only because cancellation was requested; nothing is running, so end the run here
      // instead of leaving it queued until a recovery sweep (which is off by default).
      await this.dbService.finalizeCancelledRun(runId);
      return { success: false, error: RUN_CANCELLATION_MARKER };
    }
    const isJobRun = Boolean(taskData.jobId);
    const testId = taskData.tests?.[0]?.id || taskData.testId || null;

    if (!testId) {
      this.logger.warn(
        `k6 task ${job.id} missing testId; proceeding without linking to a saved test`,
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
          errorDetails: RUN_CANCELLATION_MARKER,
        })
        .where(
          and(
            eq(schema.runs.id, runId),
            inArray(schema.runs.status, ['queued', 'running']),
          ),
        );

      return {
        success: false,
        timedOut: false,
        error: RUN_CANCELLATION_MARKER,
      };
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
        .where(
          and(
            eq(schema.runs.id, runId),
            inArray(schema.runs.status, ['queued', 'running']),
          ),
        );

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
      // Backstop for stale or misrouted jobs: never execute in a location that
      // lost k6 capability. Checked inside the try so the run is marked failed
      // (with job status and notifications) instead of staying queued. A DB
      // error throws and retries; unknown capability is never treated as allowed.
      const jobLocation = effectiveJobLocation.toLowerCase();
      if (jobLocation !== 'global' && !jobLocationIsWildcard) {
        const allowed = await locationSupportsWorkload(
          this.dbService,
          jobLocation,
          'k6',
        );
        if (!allowed) {
          throw new UnrecoverableError(
            `Location "${jobLocation}" does not support k6 execution`,
          );
        }
      }

      // Mark run as in-progress
      await this.dbService.db
        .update(schema.runs)
        .set({
          status: 'running',
          // The app marks runs running at admission; keep that timestamp.
          startedAt: sql`coalesce(${schema.runs.startedAt}, now())`,
          location: effectiveJobLocation,
        })
        .where(
          and(
            eq(schema.runs.id, runId),
            inArray(schema.runs.status, ['queued', 'running']),
          ),
        );

      // Execute k6
      const result = await this.k6ExecutionService.runK6Test(taskData);
      // Meter only container run time evidenced by Kubernetes.
      const billableMs = result.billableMs ?? 0;
      observedBillableMs = billableMs;
      observedVirtualUsers = result.billingVirtualUsers;

      // Log execution result
      this.logger.log(
        `[${isJobRun ? 'K6 Job' : 'K6 Test'}] ${runId} ${result.success ? 'passed' : 'failed'}`,
      );

      // Extract metrics from summary
      const metrics = this.extractMetrics(result.summary);

      const wasCancelled = result.cancelled === true;

      // Create k6_performance_runs record
      const totalRequests = Math.round(metrics.totalRequests || 0);
      const failedRequests = Math.round(metrics.failedRequests || 0);
      const requestRateScaled = Math.round((metrics.requestRate || 0) * 100);
      const avgDurationMs = Math.round(metrics.avgResponseTimeMs || 0);
      const p95DurationMs = Math.round(metrics.p95ResponseTimeMs || 0);
      const p99DurationMs = Math.round(metrics.p99ResponseTimeMs || 0);

      // Determine k6_performance_runs status
      // - 'error': cancelled, timed out, or execution error (no summary = couldn't run at all)
      // - 'failed': test ran but thresholds breached or checks failed
      // - 'passed': test ran successfully
      // Note: timedOut is a standalone condition since result.error might be null for timeouts
      const isExecutionError =
        !result.success &&
        (result.timedOut || (!result.summary && result.error));
      const k6PerformanceStatus =
        wasCancelled || isExecutionError
          ? 'error'
          : result.success
            ? 'passed'
            : 'failed';

      await this.usageTrackerService.completeRunWithUsage(
        {
          organizationId: taskData.organizationId,
          runId,
          eventType: 'k6_execution',
          durationMs: billableMs,
          virtualUsers: result.billingVirtualUsers,
          metadata: {
            jobId: taskData.jobId,
            testId,
            location: taskData.location,
          },
        },
        async (transaction) => {
          // A replay can arrive after completion committed but before BullMQ
          // acknowledged it. Reuse the existing performance record for this run.
          const existingPerformanceRun =
            await transaction.query.k6PerformanceRuns.findFirst({
              where: and(
                eq(schema.k6PerformanceRuns.runId, runId),
                eq(
                  schema.k6PerformanceRuns.organizationId,
                  taskData.organizationId,
                ),
              ),
              columns: { id: true },
            });
          if (!existingPerformanceRun)
            await transaction.insert(schema.k6PerformanceRuns).values({
              testId,
              runId,
              jobId: taskData.jobId ?? null,
              organizationId: taskData.organizationId,
              projectId: taskData.projectId,
              location:
                effectiveJobLocation as (typeof schema.k6PerformanceRuns.$inferInsert)['location'], // Use the task's requested/resolved location
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
                ? RUN_CANCELLATION_MARKER
                : result.error,
              consoleOutput: result.consoleOutput
                ? result.consoleOutput.slice(0, 10000)
                : null,
            });

          // Update run with final status and artifacts
          const _durationSeconds = Math.max(
            0,
            Math.round(result.durationMs / 1000),
          );
          // Use the wasCancelled and isExecutionError checks from above
          // - 'error': cancelled, timed out, or execution error (Docker not available, etc.)
          // - 'failed': test ran but thresholds breached or checks failed
          const runStatus: 'passed' | 'failed' | 'error' =
            wasCancelled || isExecutionError
              ? 'error'
              : result.success
                ? 'passed'
                : 'failed';
          const runUpdate: Record<string, unknown> = {
            status: runStatus,
            completedAt: new Date(),
            durationMs: result.durationMs,
            reportS3Url: result.reportUrl,
            logsS3Url: result.logsUrl ?? null,
          };

          let metadataExpression: SQL | undefined;
          if ((result.summary as Record<string, unknown>)?.runId) {
            metadataExpression = sql`
          jsonb_set(
            coalesce(metadata, '{}'::jsonb),
            '{k6RunId}',
            to_jsonb(${String((result.summary as Record<string, unknown>).runId)})
          )
        `;
          }

          if (wasCancelled) {
            runUpdate.errorDetails = RUN_CANCELLATION_MARKER;
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
          } else if (runStatus === 'passed' || runStatus === 'failed') {
            // Completion wins a late-cancel race: do not leave a stale cancellation marker on a finished run.
            runUpdate.errorDetails = null;
          }

          if (metadataExpression) {
            runUpdate.metadata = metadataExpression;
          }

          await transaction
            .update(schema.runs)
            .set(runUpdate)
            .where(
              and(
                eq(schema.runs.id, runId),
                inArray(schema.runs.status, ['queued', 'running']),
              ),
            );
        },
      );
      usagePersisted = true;

      // Track K6 usage for billing. Cancelled runs that started a container are
      // charged for the time it ran; runs that never started are not charged.
      if (billableMs > 0 && result.billingVirtualUsers !== undefined) {
        await this.usageTrackerService
          .trackK6Execution(
            taskData.organizationId,
            result.billingVirtualUsers,
            billableMs,
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
      }

      if (taskData.jobId) {
        // Use the same execution error check for final job status
        const finalStatus =
          wasCancelled || isExecutionError
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
          ? RUN_CANCELLATION_MARKER
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

      if (
        !message.includes('cancelled') &&
        !message.includes('cancellation') &&
        !(error instanceof UnrecoverableError) &&
        (job.attemptsMade ?? 0) + 1 < (job.opts?.attempts ?? 1)
      ) {
        const attemptBillableMs = Math.max(
          getBillableMs(error),
          observedBillableMs,
        );
        if (attemptBillableMs > 0 && !usagePersisted) {
          await this.usageTrackerService.completeRunWithUsage(
            {
              organizationId: taskData.organizationId,
              runId: `${runId}:attempt:${job.attemptsMade ?? 0}`,
              eventType: 'k6_execution',
              durationMs: attemptBillableMs,
              virtualUsers:
                getBillableVirtualUsers(error) ?? observedVirtualUsers,
              metadata: {
                executionRunId: runId,
                retryAttempt: job.attemptsMade ?? 0,
                requiresAllocationReconciliation:
                  (getBillableVirtualUsers(error) ?? observedVirtualUsers) ===
                  undefined,
              },
            },
            async () => {},
          );
        }
        throw error;
      }

      // Update run record to error status before rethrowing to ensure UI and retries work correctly
      try {
        const _durationSeconds = Math.round(
          (Date.now() - processStartTime) / 1000,
        );
        // Check if this is a cancellation error
        const isCancellation =
          message.includes('cancelled') || message.includes('cancellation');

        const persistError = async (
          transaction?: Parameters<
            Parameters<UsageTrackerService['completeRunWithUsage']>[1]
          >[0],
        ) => {
          await (transaction ?? this.dbService.db)
            .update(schema.runs)
            .set({
              status: isCancellation ? 'error' : 'failed',
              completedAt: new Date(),
              durationMs: Date.now() - processStartTime,
              errorDetails: isCancellation ? RUN_CANCELLATION_MARKER : message,
            })
            .where(
              and(
                eq(schema.runs.id, runId),
                inArray(schema.runs.status, ['queued', 'running']),
              ),
            );
        };
        const failureBillableMs = Math.max(
          getBillableMs(error),
          observedBillableMs,
        );
        if (failureBillableMs > 0 && !usagePersisted) {
          await this.usageTrackerService.completeRunWithUsage(
            {
              organizationId: taskData.organizationId,
              runId,
              eventType: 'k6_execution',
              durationMs: failureBillableMs,
              virtualUsers:
                getBillableVirtualUsers(error) ?? observedVirtualUsers,
              metadata: {
                testId,
                jobId: taskData.jobId,
                executionError: true,
                requiresAllocationReconciliation:
                  (getBillableVirtualUsers(error) ?? observedVirtualUsers) ===
                  undefined,
              },
            },
            persistError,
          );
        } else {
          await persistError();
        }
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
        message.includes('cancelled') || message.includes('cancellation');

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

  private extractMetrics(summary: Record<string, unknown> | undefined | null): {
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

    const metrics = summary.metrics as
      | Record<string, Record<string, number>>
      | undefined;
    if (!metrics) {
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
    const httpReqs = metrics['http_reqs'] || {};
    const httpReqDuration = metrics['http_req_duration'] || {};
    const vus = metrics['vus'] || {};
    const vusMax = metrics['vus_max'] || {};
    const totalRequests = httpReqs.count || 0;
    const failedRequests = getFailedHttpRequestCount(metrics);

    return {
      totalRequests,
      failedRequests,
      requestRate: httpReqs.rate || 0,
      avgResponseTimeMs: httpReqDuration.avg || 0,
      p95ResponseTimeMs: httpReqDuration['p(95)'] || 0,
      p99ResponseTimeMs: httpReqDuration['p(99)'] || 0,
      maxVUs: vusMax.max || vusMax.value || vus.max || vus.value || 1, // Default to 1 VU if not found
    };
  }

  private formatSummary(
    summaryJson: Record<string, unknown> | undefined | null,
    success: boolean,
  ): string {
    if (!summaryJson) {
      return success
        ? 'k6 test completed successfully.'
        : 'k6 test failed with unknown error.';
    }

    try {
      const metrics = (summaryJson.metrics || {}) as Record<
        string,
        Record<string, number>
      >;
      const httpReqDuration = metrics['http_req_duration'] || {};
      const avg: number = httpReqDuration.avg || 0;
      const p95: number = httpReqDuration['p(95)'] || 0;
      const p99: number = httpReqDuration['p(99)'] || 0;

      return `k6 test ${success ? 'passed' : 'failed'}. Avg=${avg.toFixed(
        2,
      )}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms`;
    } catch {
      return success
        ? 'k6 test completed successfully.'
        : 'k6 test failed with unknown error.';
    }
  }

  private isWildcardLocation(location: string): boolean {
    return location === '*' || location === 'any';
  }
}

@Processor(K6_QUEUE, {
  concurrency: 1,
  lockDuration: 70 * 60 * 1000,
  stalledInterval: 30000,
  maxStalledCount: 2,
  metrics: { maxDataPoints: 60 },
  // Idle unless this worker consumes the global k6 queue (WORKER_QUEUES). The
  // instance still serves handleProcess() for the regional dynamic workers.
  autorun: consumesWorkerQueue('global-k6'),
})
export class K6ExecutionProcessor
  extends BaseK6ExecutionProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private capabilityGuard: GlobalQueueCapabilityGuard | null = null;

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

  onApplicationBootstrap(): void {
    // k6-global has no location: the consuming worker's own location decides.
    if (!consumesWorkerQueue('global-k6')) return;
    this.capabilityGuard = new GlobalQueueCapabilityGuard(
      () => this.worker,
      this.dbService,
      this.workerLocation,
      'k6',
      this.logger,
    );
    this.capabilityGuard.start();
  }

  onModuleDestroy(): void {
    this.capabilityGuard?.stop();
  }

  async process(
    job: Job<K6Task>,
  ): Promise<{ success: boolean; timedOut?: boolean }> {
    return await this.handleProcess(job);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, result: unknown) {
    const res = result as { timedOut?: boolean; success?: boolean } | undefined;
    const timedOut = Boolean(res?.timedOut);
    const status = timedOut ? 'timed out' : res?.success ? 'passed' : 'failed';
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
