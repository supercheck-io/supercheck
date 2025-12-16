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
import { jobs, runs } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { addJobToQueue, addK6JobToQueue, JobExecutionTask, K6ExecutionTask, queueLogger } from '@/lib/queue';
import { getNextRunDate } from './cron-utils';
import { DEFAULT_K6_LOCATION } from './constants';

const logger = queueLogger;

/**
 * Job data structure for scheduled jobs
 */
export interface ScheduledJobData {
  jobId: string;
  testCases: Array<{
    id: string;
    script: string;
    title: string;
    type?: string;
  }>;
  retryLimit?: number;
  variables: Record<string, string>;
  secrets: Record<string, string>;
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

  try {
    const data = job.data;
    logger.info({ jobId }, 'Processing scheduled job trigger');

    // Check if job already has a running execution
    const runningRuns = await db
      .select()
      .from(runs)
      .where(and(eq(runs.jobId, jobId), eq(runs.status, 'running')));

    if (runningRuns.length > 0) {
      logger.warn({ jobId }, 'Job already has a running execution, skipping');
      return { success: true };
    }

    // Get job record
    const jobData = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (jobData.length === 0) {
      logger.error({ jobId }, 'Job not found');
      return { success: false };
    }

    const jobRecord = jobData[0];
    const jobType = jobRecord.jobType ?? 'playwright';
    const isK6Job = jobType === 'k6';
    const resolvedLocation = isK6Job ? DEFAULT_K6_LOCATION : null;

    const runId = crypto.randomUUID();
    const projectId = data.projectId;
    const organizationId = data.organizationId;

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

    logger.info({ jobId, runId }, 'Created run record for scheduled job');

    // Update job's next run time
    const cronSchedule = jobRecord.cronSchedule;
    let nextRunAt: Date | null = null;

    try {
      if (cronSchedule) {
        nextRunAt = getNextRunDate(cronSchedule);
      }
    } catch (error) {
      logger.error({ jobId, error }, 'Failed to calculate next run date');
    }

    const now = new Date();
    const jobUpdatePayload: {
      lastRunAt: Date;
      nextRunAt?: Date;
      status: 'running';
    } = {
      lastRunAt: now,
      status: 'running',
    };

    if (nextRunAt) {
      jobUpdatePayload.nextRunAt = nextRunAt;
    }

    await db.update(jobs).set(jobUpdatePayload).where(eq(jobs.id, jobId));

    // Prepare test scripts
    const processedTestScripts = data.testCases.map((test) => ({
      id: test.id,
      script: test.script,
      name: test.title,
      type: test.type,
    }));

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
          .where(eq(runs.id, runId));
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
          .where(eq(runs.id, runId));
        return { success: false };
      }

      // Use capacity-managed K6 queue function
      const k6Task: K6ExecutionTask = {
        runId,
        testId: primaryTestId,
        organizationId,
        projectId,
        script: primaryScript,
        jobId,
        tests: processedTestScripts.map((script) => ({
          id: script.id,
          script: script.script,
        })),
        location: resolvedLocation,
        jobType: 'k6',
      };

      try {
        const result = await addK6JobToQueue(k6Task, 'k6-job-execution');
        logger.info(
          { jobId, runId, status: result.status, position: result.position },
          'Enqueued k6 execution task for scheduled job'
        );

        // Update run status based on capacity result
        if (result.status === 'running') {
          await db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId));
        }
        // If 'queued', status is already 'queued'
      } catch (error) {
        logger.error({ jobId, runId, error }, 'Failed to enqueue k6 job');
        await db
          .update(runs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            errorDetails: error instanceof Error ? error.message : 'Failed to enqueue job',
          })
          .where(eq(runs.id, runId));
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
        variables: data.variables,
        secrets: data.secrets,
        jobType: 'playwright',
      };

      try {
        const result = await addJobToQueue(playwrightTask);
        logger.info(
          { jobId, runId, status: result.status, position: result.position },
          'Enqueued Playwright execution task for scheduled job'
        );

        // Update run status based on capacity result
        if (result.status === 'running') {
          await db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId));
        }
      } catch (error) {
        logger.error({ jobId, runId, error }, 'Failed to enqueue Playwright job');
        await db
          .update(runs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            errorDetails: error instanceof Error ? error.message : 'Failed to enqueue job',
          })
          .where(eq(runs.id, runId));
        return { success: false };
      }
    }

    return { success: true };
  } catch (error) {
    logger.error({ jobId, error }, 'Failed to process scheduled job trigger');

    // Update job status to error
    try {
      await db.update(jobs).set({ status: 'error' }).where(eq(jobs.id, jobId));

      await db
        .update(runs)
        .set({
          status: 'error',
          errorDetails: `Failed to process scheduled job: ${
            error instanceof Error ? error.message : String(error)
          }`,
          completedAt: new Date(),
        })
        .where(and(eq(runs.jobId, jobId), eq(runs.status, 'queued')));
    } catch (dbError) {
      logger.error({ jobId, dbError }, 'Failed to update job/run status to error');
    }

    return { success: false };
  }
}
