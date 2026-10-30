import { getExecutionPolicy, ExecutionWorkloadError } from "@/lib/execution/execution-policy";
/**
 * Job Scheduler Processor
 *
 * Handles scheduled job triggers for both Playwright and K6 jobs.
 * Uses the app's capacity management system to ensure scheduled jobs
 * respect concurrency limits.
 */

import { Job } from 'bullmq';
import crypto from 'crypto';
import { db } from '@/utils/db';
import { jobs, runs, projects } from '@/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { addJobToQueue, addK6JobToQueue, JobExecutionTask, K6ExecutionTask, queueLogger } from '@/lib/queue';
import { prepareJobTestScripts } from '@/lib/job-execution-utils';
import { getNextRunDate } from './cron-utils';
import {
  assertProjectSupportsBrowser,
  LocationWorkloadUnavailableError,
  resolveProjectK6Location,
} from '@/lib/location-registry';
import {
  SubscriptionAccessDeniedError,
} from '@/lib/services/subscription-service';
import { polarUsageService } from '@/lib/services/polar-usage.service';
import { getSafeExecutionQueueErrorDetails } from '@/lib/execution-api-responses';

const logger = queueLogger;

// A run queued this long never reached the worker; stop it blocking future ticks.

async function removeOrphanedSchedule(jobId: string, reason: string): Promise<void> {
  // Dynamic import: lib/job-scheduler imports this module.
  const { deleteScheduledJob } = await import('@/lib/job-scheduler');
  const removed = await deleteScheduledJob(jobId, { throwOnError: true });
  logger.warn({ jobId, removed, reason }, 'Removed schedule for job that should no longer run');
}

/**
 * Job data structure for scheduled jobs
 * 
 * IMPORTANT: Only identifiers are stored in the repeatable payload.
 * Test scripts and variables are resolved at trigger time via prepareJobTestScripts()
 * to ensure scheduled executions always use the latest test content and variable values.
 */
export interface ScheduledJobData {
  jobId: string;
  /** @deprecated Legacy field — new schedules no longer embed test cases in payload */
  testCases?: Array<{
    id: string;
    script: string;
    title: string;
    type?: string;
  }>;
  retryLimit?: number;
  /** @deprecated Legacy field — variables are now resolved at trigger time */
  variables?: Record<string, string>;
  /** @deprecated Legacy field — secrets are now resolved at trigger time */
  secrets?: Record<string, string>;
  projectId: string;
  organizationId: string;
}

/**
 * Process a scheduled job trigger
 *
 * This function is called by the BullMQ worker when a scheduled job is due.
 * It creates a run record and uses the capacity-managed queue functions
 * to enqueue the execution.
 */
export async function processScheduledJob(
  job: Job<ScheduledJobData>
): Promise<{ success: boolean }> {
  const jobId = job.data?.jobId;

  if (!jobId) {
    logger.error({ jobData: job.data }, 'Job ID is undefined or null in job data');
    return { success: false };
  }

  // Set once this tick's run row exists, so the catch only touches that row.
  let insertedRunId: string | null = null;

  try {
    const data = job.data;
    logger.info({ jobId }, 'Processing scheduled job trigger');

    // Get job record
    const jobData = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (jobData.length === 0) {
      logger.error({ jobId }, 'Job not found');
      await removeOrphanedSchedule(jobId, 'job_not_found');
      return { success: false };
    }

    const jobRecord = jobData[0];
    const jobType = jobRecord.jobType ?? 'playwright';
    const isK6Job = jobType === 'k6';

    const runId = crypto.randomUUID();
    const projectId = jobRecord.projectId;
    const organizationId = jobRecord.organizationId;

    if (!projectId || !organizationId) {
      logger.error({ jobId }, 'Scheduled job is missing project or organization ownership');
      return { success: false };
    }

    const [project] = await db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!jobRecord.cronSchedule || project?.status === 'deleted') {
      await removeOrphanedSchedule(jobId, jobRecord.cronSchedule ? 'project_deleted' : 'schedule_cleared');
      return { success: true };
    }

    // Advance the next run time before any early return, so a skipped tick (overlap, billing) does
    // not leave a stale "next run" behind.
    try {
      if (jobRecord.cronSchedule) {
        await db.update(jobs).set({ nextRunAt: getNextRunDate(jobRecord.cronSchedule) }).where(eq(jobs.id, jobId));
      }
    } catch (error) {
      logger.error({ jobId, error }, 'Failed to update the next run date');
    }

    // Runs stuck in queued are recovered by the worker's stalled-run sweep, which can tell a lost run
    // from one still waiting in the organization's capacity queue.
    // A queued run already owns capacity/queue position and must also prevent
    // the next cron tick from creating a duplicate execution.
    const activeRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.jobId, jobId),
          inArray(runs.status, ['queued', 'running']),
        ),
      )
      .limit(1);

    if (activeRuns.length > 0) {
      logger.warn({ jobId }, 'Job already has a queued or running execution, skipping');
      return { success: true };
    }

    // Leave one visible blocked run per blocked spell, not one per tick.
    const recordBlockedRun = async (reason: string) => {
      const [latest] = await db
        .select({ status: runs.status, errorDetails: runs.errorDetails })
        .from(runs)
        .where(eq(runs.jobId, jobId))
        .orderBy(desc(runs.createdAt))
        .limit(1);
      if (latest?.status === 'blocked' && latest.errorDetails === reason) {
        logger.info({ jobId }, 'Scheduled run still blocked; not recording another blocked run');
        return;
      }
      const now = new Date();
      await db.insert(runs).values({
        id: runId,
        jobId,
        status: 'blocked',
        startedAt: now,
        completedAt: now,
        trigger: 'schedule',
        projectId,
        errorDetails: reason,
        metadata: { jobType, executionEngine: isK6Job ? 'k6' : 'playwright' },
      });
      insertedRunId = runId;
    };

    // Scheduled executions must pass the same subscription and spending
    // controls as user/API-triggered executions. Expected policy denials skip
    // the tick; operational failures are rethrown for BullMQ retry/backoff.
    try {
      const policy = await getExecutionPolicy(organizationId);
      const spendingBlock = policy.tier === "paid" ? await polarUsageService.shouldBlockUsage(organizationId) : { blocked: false };
      if (spendingBlock.blocked) {
        logger.warn(
          { jobId, organizationId, reason: spendingBlock.reason },
          'Scheduled execution blocked by spending limit',
        );
        await recordBlockedRun(spendingBlock.reason ?? 'Monthly spending limit reached');
        return { success: true };
      }
    } catch (error) {
      if (error instanceof SubscriptionAccessDeniedError || error instanceof ExecutionWorkloadError) {
        logger.warn(
          { jobId, organizationId, reason: error instanceof SubscriptionAccessDeniedError ? error.reason : "execution_entitlement_required" },
          'Scheduled execution blocked by subscription validation',
        );
        await recordBlockedRun(error.message);
        return { success: true };
      }
      logger.error(
        { jobId, organizationId, error },
        'Scheduled execution billing validation failed',
      );
      throw error;
    }

    // Resolve location using project-aware logic (respects project location restrictions)
    // A workload with no eligible location is a configuration error: skip the tick
    // instead of retrying, and never run in another geography.
    let resolvedLocation: string | null = null;
    try {
      if (isK6Job) {
        resolvedLocation = await resolveProjectK6Location(projectId);
      } else {
        await assertProjectSupportsBrowser(projectId);
      }
    } catch (error) {
      if (error instanceof LocationWorkloadUnavailableError) {
        logger.warn(
          { jobId, projectId, workload: error.workload },
          'Scheduled execution skipped: no eligible location for this workload',
        );
        // Leave a visible failed run so the skipped tick is not silent.
        const now = new Date();
        await db.insert(runs).values({
          id: runId,
          jobId,
          status: 'failed',
          startedAt: now,
          completedAt: now,
          trigger: 'schedule',
          projectId,
          errorDetails: error.message,
          metadata: {
            jobType,
            executionEngine: isK6Job ? 'k6' : 'playwright',
          },
        });
        return { success: true };
      }
      throw error;
    }

    // Create run record with 'queued' status - capacity manager will update to 'running'
    await db.insert(runs).values({
      id: runId,
      jobId: jobId,
      status: 'queued', // Start as queued - capacity manager handles promotion
      startedAt: new Date(),
      trigger: 'schedule',
      projectId: projectId,
      location: resolvedLocation,
      metadata: {
        jobType,
        executionEngine: isK6Job ? 'k6' : 'playwright',
        ...(isK6Job ? { location: resolvedLocation } : {}),
      },
    });

    insertedRunId = runId;
    logger.info({ jobId, runId }, 'Created run record for scheduled job');

    await db.update(jobs).set({ lastRunAt: new Date() }).where(eq(jobs.id, jobId));

    // Fetch current test scripts and resolve variables at trigger time
    // This ensures scheduled executions always use the latest test content
    let processedTestScripts: Awaited<
      ReturnType<typeof prepareJobTestScripts>
    >['testScripts'];
    let variableResolution: Awaited<
      ReturnType<typeof prepareJobTestScripts>
    >['variableResolution'];
    try {
      const prepared = await prepareJobTestScripts(
        jobId,
        projectId,
        runId,
        `[Scheduled ${jobId}/${runId}]`
      );
      processedTestScripts = prepared.testScripts;
      variableResolution = prepared.variableResolution;
    } catch (error) {
      logger.error({ jobId, runId, error }, 'Failed to prepare test scripts for scheduled job');
      await db
        .update(runs)
        .set({
          status: 'failed',
          completedAt: new Date(),
          errorDetails: 'Failed to prepare test scripts',
        })
        .where(and(eq(runs.id, runId), inArray(runs.status, ['queued', 'running'])));
      return { success: false };
    }

    // Route to appropriate queue with capacity management
    if (isK6Job) {
      const primaryScript = processedTestScripts[0]?.script ?? '';
      const primaryTestId = processedTestScripts[0]?.id;
      const primaryType = processedTestScripts[0]?.type;

      if (!primaryTestId || !primaryScript) {
        logger.error({ jobId, runId }, 'Unable to prepare k6 script for scheduled job execution');
        await db
          .update(runs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            errorDetails: 'Unable to prepare k6 script for execution',
          })
          .where(and(eq(runs.id, runId), inArray(runs.status, ['queued', 'running'])));
        return { success: false };
      }

      if (primaryType && primaryType !== 'performance') {
        logger.error({ jobId, runId, primaryTestId }, 'Scheduled k6 job references non-performance test');
        await db
          .update(runs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            errorDetails: 'k6 jobs require performance tests',
          })
          .where(and(eq(runs.id, runId), inArray(runs.status, ['queued', 'running'])));
        return { success: false };
      }

      // Use capacity-managed K6 queue function
      const k6Task: K6ExecutionTask = {
        runId,
        testId: primaryTestId,
        organizationId,
        projectId,
        script: primaryScript,
        variables: variableResolution.variables,
        secrets: variableResolution.secrets,
        files: variableResolution.files,
        jobId,
        tests: processedTestScripts.map((script) => ({
          id: script.id,
          script: script.script,
        })),
        location: resolvedLocation,
        jobType: 'k6',
      };

      try {
        // Before enqueueing: a fast worker may finish and set the final status before we return.
        await db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, jobId));
        const result = await addK6JobToQueue(k6Task, 'k6-job-execution');
        logger.info(
          { jobId, runId, status: result.status, position: result.position },
          'Enqueued k6 execution task for scheduled job'
        );

        // Update run status based on capacity result
        if (result.status === 'running') {
          await db.update(runs).set({ status: 'running' }).where(and(eq(runs.id, runId), eq(runs.status, 'queued')));
        }
        // If 'queued', status is already 'queued'
      } catch (error) {
        logger.error({ jobId, runId, error }, 'Failed to enqueue k6 job');
        await db.update(jobs).set({ status: jobRecord.status }).where(eq(jobs.id, jobId));
        await db
          .update(runs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            errorDetails: getSafeExecutionQueueErrorDetails(error),
          })
          .where(and(eq(runs.id, runId), inArray(runs.status, ['queued', 'running'])));
        return { success: false };
      }
    } else {
      // Playwright job - use capacity-managed queue function
      const playwrightTask: JobExecutionTask = {
        runId,
        jobId,
        testScripts: processedTestScripts,
        trigger: 'schedule',
        organizationId,
        projectId,
        variables: variableResolution.variables,
        secrets: variableResolution.secrets,
        files: variableResolution.files,
        jobType: 'playwright',
      };

      try {
        // Before enqueueing: a fast worker may finish and set the final status before we return.
        await db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, jobId));
        const result = await addJobToQueue(playwrightTask);
        logger.info(
          { jobId, runId, status: result.status, position: result.position },
          'Enqueued Playwright execution task for scheduled job'
        );

        // Update run status based on capacity result
        if (result.status === 'running') {
          await db.update(runs).set({ status: 'running' }).where(and(eq(runs.id, runId), eq(runs.status, 'queued')));
        }
      } catch (error) {
        logger.error({ jobId, runId, error }, 'Failed to enqueue Playwright job');
        await db.update(jobs).set({ status: jobRecord.status }).where(eq(jobs.id, jobId));
        await db
          .update(runs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            errorDetails: getSafeExecutionQueueErrorDetails(error),
          })
          .where(and(eq(runs.id, runId), inArray(runs.status, ['queued', 'running'])));
        return { success: false };
      }
    }

    return { success: true };
  } catch (error) {
    logger.error({ jobId, error }, 'Failed to process scheduled job trigger');

    // Only mark state this tick created; with no run inserted there is nothing to fail.
    if (insertedRunId) {
      try {
        await db.update(jobs).set({ status: 'error' }).where(eq(jobs.id, jobId));
        await db
          .update(runs)
          .set({
            status: 'error',
            errorDetails: 'Failed to process scheduled job',
            completedAt: new Date(),
          })
          .where(and(eq(runs.id, insertedRunId), eq(runs.status, 'queued')));
      } catch (dbError) {
        logger.error({ jobId, dbError }, 'Failed to update job/run status to error');
      }
    }

    throw error;
  }
}
