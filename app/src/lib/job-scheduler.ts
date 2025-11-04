import { Job } from "bullmq";
import { db } from "@/utils/db";
import { jobs, runs } from "@/db/schema";
import { JobTrigger } from "@/db/schema";
import { eq, isNotNull, and } from "drizzle-orm";
import {
  getQueues,
  JobExecutionTask,
  JOB_EXECUTION_QUEUE,
  K6_JOB_EXECUTION_QUEUE,
} from "./queue";
import crypto from "crypto";
import { getNextRunDate } from "@/lib/cron-utils";
import {
  createDataLifecycleService,
  setDataLifecycleInstance,
  type DataLifecycleService,
} from "./data-lifecycle-service";
import { prepareJobTestScripts } from "./job-execution-utils";

interface ScheduleOptions {
  name: string;
  cron: string;
  timezone?: string;
  jobId: string;
  // queue: string; // This is now constant (JOB_EXECUTION_QUEUE)
  retryLimit?: number;
}

/**
 * Creates or updates a job scheduler using BullMQ
 */
export async function scheduleJob(options: ScheduleOptions): Promise<string> {
  try {
    // Setting up scheduled job

    // Get queues from central management
    const { jobSchedulerQueue, k6JobSchedulerQueue } = await getQueues();

    // Generate a unique name for this scheduled job
    const schedulerJobName = `scheduled-job-${options.jobId}`;

    // First, get job information to access projectId
    const jobData = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, options.jobId))
      .limit(1);

    if (jobData.length === 0) {
      throw new Error(`Job ${options.jobId} not found`);
    }

    const job = jobData[0];
    const { testScripts, variableResolution } = await prepareJobTestScripts(
      options.jobId,
      job.projectId || "",
      crypto.randomUUID(), // temporary runId for logging
      `[Schedule Job ${options.jobId}]`
    );

    // Convert to the format expected by the worker
    const testCases = testScripts.map((script) => ({
      id: script.id,
      title: script.name,
      script: script.script, // This is already decoded and has variables resolved
      type: script.type,
    }));

    // Prepared test cases with variables resolved

    // Clean up any existing repeatable jobs for this job ID
    const schedulerQueue = job.jobType === "k6" ? k6JobSchedulerQueue : jobSchedulerQueue;

    const repeatableJobs = await schedulerQueue.getRepeatableJobs();
    const existingJob = repeatableJobs.find(
      (job) =>
        job.id === options.jobId ||
        job.key.includes(options.jobId) ||
        job.name === schedulerJobName
    );

    if (existingJob) {
      // Removing existing job
      await schedulerQueue.removeRepeatableByKey(existingJob.key);
    }

    // Create a repeatable job that follows the cron schedule
    // The worker for JOB_SCHEDULER_QUEUE will process this.
    // The data payload contains what's needed to create the *actual* execution job.
    const executionQueueName = job.jobType === "k6"
      ? K6_JOB_EXECUTION_QUEUE
      : JOB_EXECUTION_QUEUE;

    await schedulerQueue.add(
      schedulerJobName,
      {
        jobId: options.jobId,
        name: options.name,
        testCases,
        queue: executionQueueName, // Keep for handleScheduledJobTrigger
        retryLimit: options.retryLimit || 3,
        // Pass resolved variables and job info to worker
        variables: variableResolution.variables,
        secrets: variableResolution.secrets,
        projectId: job.projectId!,
        organizationId: job.organizationId!,
      },
      {
        repeat: {
          pattern: options.cron,
          tz: options.timezone || "UTC",
        },
        removeOnComplete: true,
        removeOnFail: 100,
        jobId: schedulerJobName, // Use a deterministic job ID for easier removal
      }
    );

    // Update the job's nextRunAt field in the database
    let nextRunAt = null;
    try {
      if (options.cron) {
        nextRunAt = getNextRunDate(options.cron);
      }
    } catch (error) {
      console.error(`Failed to calculate next run date: ${error}`);
    }

    if (nextRunAt) {
      await db
        .update(jobs)
        .set({ nextRunAt })
        .where(eq(jobs.id, options.jobId));
    }

    // WORKER LOGIC IS NOW IN A DEDICATED WORKER SERVICE
    // await ensureSchedulerWorker();

    // Job scheduler created
    return options.jobId;
  } catch (error) {
    console.error(`Failed to schedule job:`, error);
    throw error;
  }
}

/**
 * Handles a scheduled job trigger by creating a run record and adding an execution task
 *
 * NOTE: This function is the logic for a BullMQ worker. It is being kept here
 * for reference but should be moved to and executed by your dedicated worker service
 * (e.g., the `runner` application). When a job on the `JOB_SCHEDULER_QUEUE` is
 * processed, this is the code that should run.
 */
export async function handleScheduledJobTrigger(job: Job) {
  const jobId = job.data.jobId;
  try {
    const data = job.data;

    // Handling job trigger

    // Check if there's already a run in progress for this job
    const runningRuns = await db
      .select()
      .from(runs)
      .where(and(eq(runs.jobId, jobId), eq(runs.status, "running")));

    if (runningRuns.length > 0) {
      // Job already running, skipping
      return;
    }

    // Create a run record
    const runId = crypto.randomUUID();

    // Insert with known fields from the schema
    await db.insert(runs).values({
      id: runId,
      jobId: jobId,
      status: "running", // Using direct value matching TestRunStatus from schema
      startedAt: new Date(),
      trigger: "schedule" as JobTrigger,
    });

    // Created run record

    // Update job's lastRunAt field and calculate nextRunAt
    const now = new Date();
    const jobData = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (jobData.length > 0) {
      const cronSchedule = jobData[0].cronSchedule;
      let nextRunAt = null;

      try {
        if (cronSchedule) {
          nextRunAt = getNextRunDate(cronSchedule);
        }
      } catch (error) {
        console.error(`Failed to calculate next run date: ${error}`);
      }

      await db
        .update(jobs)
        .set({
          lastRunAt: now,
          nextRunAt: nextRunAt,
          status: "running", // Using direct value matching JobStatus from schema
        })
        .where(eq(jobs.id, jobId));
    }

    // Get the queue for execution
    const { jobQueue } = await getQueues();

    // Process the test cases that were passed from the scheduler setup
    // These contain the test scripts that were fetched at scheduling time
    if (!data.testCases || data.testCases.length === 0) {
      console.error(
        `[${jobId}/${runId}] No test cases found in scheduled job data`
      );
      throw new Error("No test cases found for scheduled job");
    }

    // Use pre-resolved test cases and variables from the scheduler data
    // All scheduled jobs now have variables resolved on the app side for consistency
    const processedTestScripts = data.testCases.map(
      (test: { id: string; script: string; title: string }) => ({
        id: test.id,
        name: test.title || `Test ${test.id}`,
        script: test.script, // Script is already decoded and has variables resolved
      })
    );

    if (processedTestScripts.length === 0) {
      console.error(
        `[${jobId}/${runId}] No test scripts found in scheduled job data`
      );
      throw new Error("No test scripts found for scheduled job");
    }

    console.log(
      `[${jobId}/${runId}] Using ${processedTestScripts.length} pre-resolved test scripts from scheduled job data`
    );

    // Use pre-resolved variables from the scheduler data
    const variableResolution = {
      variables: data.variables,
      secrets: data.secrets,
    };

    // Create task for runner service with all necessary information
    const task: JobExecutionTask = {
      runId,
      jobId,
      testScripts: processedTestScripts,
      trigger: "schedule",
      organizationId: data.organizationId,
      projectId: data.projectId,
      variables: variableResolution.variables,
      secrets: variableResolution.secrets,
    };

    // Add task to the execution queue - always use runId as both job name and ID
    // This ensures SSE can find it consistently for both manual and scheduled jobs
    const jobOptions = {
      jobId: runId, // Set explicit jobId to match runId for SSE lookups
      attempts: data.retryLimit || 3,
      backoff: {
        type: "exponential" as const,
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    };

    await jobQueue.add(runId, task, jobOptions);

    // Created execution task
  } catch (error) {
    console.error(`Failed to process scheduled job trigger:`, error);

    // Update job status to error
    try {
      await db
        .update(jobs)
        .set({
          status: "error", // Using direct value matching JobStatus from schema
        })
        .where(eq(jobs.id, jobId));

      // Update any "running" runs to "error" status
      await db
        .update(runs)
        .set({
          status: "error", // Using direct value matching TestRunStatus from schema
          errorDetails: `Failed to process scheduled job: ${
            error instanceof Error ? error.message : String(error)
          }`,
          completedAt: new Date(),
        })
        .where(and(eq(runs.jobId, jobId), eq(runs.status, "running")));
    } catch (dbError) {
      console.error(`Failed to update job/run status:`, dbError);
    }
  }
}

/**
 * Deletes a job scheduler
 */
export async function deleteScheduledJob(
  schedulerId: string
): Promise<boolean> {
  try {
    // Removing job scheduler

    const { jobSchedulerQueue, k6JobSchedulerQueue } = await getQueues();

    const schedulerQueues = [jobSchedulerQueue, k6JobSchedulerQueue];
    const schedulerJobName = `scheduled-job-${schedulerId}`;

    let removed = false;

    for (const queue of schedulerQueues) {
      const repeatableJobs = await queue.getRepeatableJobs();
      const jobsToRemove = repeatableJobs.filter(
        (job) =>
          job.id === schedulerId ||
          job.key.includes(schedulerId) ||
          job.name === schedulerJobName ||
          job.key.includes(schedulerJobName)
      );

      if (jobsToRemove.length === 0) {
        continue;
      }

      await Promise.all(
        jobsToRemove.map(async (job) => queue.removeRepeatableByKey(job.key))
      );

      removed = true;
    }

    return removed;
  } catch (error) {
    console.error(`Failed to delete scheduled job:`, error);
    return false;
  }
}

/**
 * Initializes job schedulers for all jobs with cron schedules
 * Called on application startup
 */
export async function initializeJobSchedulers() {
  try {
    // Initializing job scheduler

    const jobsWithSchedules = await db
      .select()
      .from(jobs)
      .where(isNotNull(jobs.cronSchedule));

    // Found scheduled jobs to initialize

    let initializedCount = 0;
    let failedCount = 0;

    for (const job of jobsWithSchedules) {
      if (!job.cronSchedule) continue;

      try {
        const schedulerId = await scheduleJob({
          name: job.name,
          cron: job.cronSchedule,
          jobId: job.id,
          // queue: JOB_EXECUTION_QUEUE, // No longer needed here
          retryLimit: 3,
        });

        // Update the job with the scheduler ID if needed
        if (!job.scheduledJobId || job.scheduledJobId !== schedulerId) {
          let nextRunAt = null;

          try {
            if (job.cronSchedule) {
              nextRunAt = getNextRunDate(job.cronSchedule);
            }
          } catch (error) {
            console.error(`Failed to calculate next run date: ${error}`);
          }

          await db
            .update(jobs)
            .set({
              scheduledJobId: schedulerId,
              nextRunAt: nextRunAt,
            })
            .where(eq(jobs.id, job.id));
        }

        // Initialized job scheduler
        initializedCount++;
      } catch (error) {
        console.error(
          `Failed to initialize scheduler for job ${job.id}:`,
          error
        );
        failedCount++;
      }
    }

    // Job scheduler initialization complete
    return {
      success: true,
      initialized: initializedCount,
      failed: failedCount,
    };
  } catch (error) {
    console.error(`Failed to initialize job schedulers:`, error);
    return { success: false, error };
  }
}

/**
 * Cleanup function to close all queues and workers
 * Should be called when shutting down the application
 */
export async function cleanupJobScheduler() {
  try {
    // Cleaning up job scheduler

    // Clean up orphaned repeatable jobs in Redis
    try {
      // Cleaning up orphaned entries
      const { jobSchedulerQueue, k6JobSchedulerQueue } = await getQueues();

      const schedulerQueues = [jobSchedulerQueue, k6JobSchedulerQueue];
      const repeatableJobsByQueue = await Promise.all(
        schedulerQueues.map(async (queue) => ({
          queue,
          jobs: await queue.getRepeatableJobs(),
        }))
      );

      // Get all jobs with schedules from the database
      const jobsWithSchedules = await db
        .select({ id: jobs.id, scheduledJobId: jobs.scheduledJobId })
        .from(jobs)
        .where(isNotNull(jobs.scheduledJobId));

      const validJobIds = new Set(
        jobsWithSchedules.map(
          (job: { id: string; scheduledJobId: string | null }) => job.id
        )
      );
      const validSchedulerIds = new Set(
        jobsWithSchedules
          .map(
            (job: { id: string; scheduledJobId: string | null }) =>
              job.scheduledJobId
          )
          .filter(Boolean)
      );

      // Find orphaned jobs (jobs in Redis that don't have a valid jobId or schedulerId in the database)
      await Promise.all(
        repeatableJobsByQueue.flatMap(({ queue, jobs }) => {
          const orphanedJobs = jobs.filter((job) => {
            const jobIdMatch = job.name?.match(/scheduled-job-([0-9a-f-]+)/);
            const jobId = jobIdMatch ? jobIdMatch[1] : null;

            return (
              (!jobId || !validJobIds.has(jobId)) &&
              (!job.id || !validSchedulerIds.has(job.id as string))
            );
          });

          return orphanedJobs.map((job) =>
            queue.removeRepeatableByKey(job.key)
          );
        })
      );

      // The queue is managed centrally, so we don't close it here.
      // await schedulerQueue.close();
    } catch (redisError) {
      console.error("Error cleaning up Redis entries:", redisError);
      // Continue with initialization even if cleanup fails
    }

    // Job scheduler cleanup complete
    return true;
  } catch (error) {
    console.error("Failed to cleanup job scheduler:", error);
    return false;
  }
}

/**
 * Initialize unified data lifecycle service (RECOMMENDED)
 * This replaces individual cleanup services with a unified approach
 * Called on application startup
 */
export async function initializeDataLifecycleService(): Promise<DataLifecycleService | null> {
  try {
    console.log(
      "[DATA_LIFECYCLE] Initializing unified data lifecycle service..."
    );

    // Create the unified data lifecycle service
    const lifecycleService = createDataLifecycleService();

    // Get Redis connection from existing queue system
    const { redisConnection } = await getQueues();

    // Initialize the lifecycle service with Redis connection
    await lifecycleService.initialize(redisConnection);

    // Set the global instance for access throughout the app
    setDataLifecycleInstance(lifecycleService);

    console.log("[DATA_LIFECYCLE] Initialized successfully");
    return lifecycleService;
  } catch (error) {
    console.error("[DATA_LIFECYCLE] Failed to initialize:", error);
    // Don't fail the entire initialization
    return null;
  }
}

/**
 * Cleanup unified data lifecycle service
 * Should be called when shutting down the application
 */
export async function cleanupDataLifecycleService(): Promise<void> {
  try {
    console.log("[DATA_LIFECYCLE] Shutting down...");

    const { getDataLifecycleService } = await import(
      "./data-lifecycle-service"
    );
    const lifecycleService = getDataLifecycleService();

    if (lifecycleService) {
      await lifecycleService.shutdown();
      console.log("[DATA_LIFECYCLE] Shutdown complete");
    } else {
      console.log("[DATA_LIFECYCLE] No service instance to shutdown");
    }
  } catch (error) {
    console.error("[DATA_LIFECYCLE] Failed to shutdown:", error);
    // Don't fail the entire cleanup process
  }
}
