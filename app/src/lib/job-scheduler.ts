import { Job } from "bullmq";
import { db } from "@/utils/db";
import { jobs } from "@/db/schema";
import { eq, isNotNull, and } from "drizzle-orm";
import { getQueues } from "./queue";
import { getNextRunDate } from "@/lib/cron-utils";
import {
  createDataLifecycleService,
  setDataLifecycleInstance,
  type DataLifecycleService,
} from "./data-lifecycle-service";
import {
  processScheduledJob,
  type ScheduledJobData,
} from "./scheduler/job-scheduler";

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

    // First, get job information to access projectId and jobType
    const jobData = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, options.jobId))
      .limit(1);

    if (jobData.length === 0) {
      throw new Error(`Job ${options.jobId} not found`);
    }

    const job = jobData[0];

    // IMPORTANT: Only store identifiers in the repeatable payload.
    // Test scripts and variables are fetched at trigger time by processScheduledJob
    // to ensure executions always use the latest test content and variable values.

    // Clean up ALL existing repeatable jobs for this job ID
    // Using .filter() instead of .find() to remove ALL matching jobs,
    // preventing accumulated schedules from causing multiple triggers
    const schedulerQueue = job.jobType === "k6" ? k6JobSchedulerQueue : jobSchedulerQueue;

    const repeatableJobs = await schedulerQueue.getRepeatableJobs();
    const existingJobs = repeatableJobs.filter(
      (job) =>
        job.id === options.jobId ||
        job.key.includes(options.jobId) ||
        job.name === schedulerJobName
    );

    if (existingJobs.length > 0) {
      // Removing all existing jobs for this scheduler
      await Promise.all(
        existingJobs.map(job => schedulerQueue.removeRepeatableByKey(job.key))
      );
    }

    await schedulerQueue.add(
      schedulerJobName,
      {
        // Minimal identifier payload — scripts/variables are resolved at trigger time
        jobId: options.jobId,
        name: options.name,
        retryLimit: options.retryLimit || 3,
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
  // Keep legacy export as a compatibility entrypoint, but delegate all logic
  // to the active scheduler processor to avoid behavior drift.
  await processScheduledJob(job as Job<ScheduledJobData>);
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
 * Called on application startup.
 * Uses a distributed lock to prevent race conditions in clustered environments.
 */
export async function initializeJobSchedulers() {
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds
  const LOCK_KEY = 'job:scheduler:init:lock';
  const LOCK_TTL_SECONDS = 120; // 2 minutes - enough time to initialize all schedulers

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Test Redis connection first
      const { jobSchedulerQueue } = await getQueues();
      const redisClient = await jobSchedulerQueue.client;
      await redisClient.ping();

      // Acquire distributed lock to prevent multiple instances from initializing simultaneously
      // This is critical in clustered deployments where multiple Next.js instances start together
      const lockResult = await redisClient.set(LOCK_KEY, process.pid.toString(), 'EX', LOCK_TTL_SECONDS, 'NX');
      const lockAcquired = !!lockResult;
      
      if (!lockAcquired) {
        console.log('[JobScheduler] Another instance is initializing schedulers, skipping...');
        return { success: true, initialized: 0, failed: 0 };
      }
      
      console.log('[JobScheduler] Lock acquired, initializing schedulers...');

      // Use try-finally to ensure lock is always released
      try {
        const jobsWithSchedules = await db
          .select()
          .from(jobs)
          .where(isNotNull(jobs.cronSchedule));

        if (jobsWithSchedules.length === 0) {
          return { success: true, initialized: 0, failed: 0 };
        }

        let initializedCount = 0;
        let failedCount = 0;
        
        // OPTIMIZED: Collect updates and batch them at the end
        const schedulerUpdates: { id: string; scheduledJobId: string; nextRunAt: Date | null }[] = [];

        for (const job of jobsWithSchedules) {
          if (!job.cronSchedule) continue;

          try {
            const schedulerId = await scheduleJob({
              name: job.name,
              cron: job.cronSchedule,
              jobId: job.id,
              retryLimit: 3,
            });

            // Collect updates instead of executing immediately
            if (!job.scheduledJobId || job.scheduledJobId !== schedulerId) {
              let nextRunAt = null;

              try {
                if (job.cronSchedule) {
                  nextRunAt = getNextRunDate(job.cronSchedule);
                }
              } catch (error) {
                console.error(`Failed to calculate next run date: ${error}`);
              }

              schedulerUpdates.push({
                id: job.id,
                scheduledJobId: schedulerId,
                nextRunAt,
              });
            }

            initializedCount++;
          } catch (error) {
            console.error(
              `Failed to initialize scheduler for job ${job.id}:`,
              error
            );
            failedCount++;
          }
        }
        
        // OPTIMIZED: Batch execute all updates in chunks to prevent connection pool exhaustion
        if (schedulerUpdates.length > 0) {
          console.log(`[JobScheduler] Batching ${schedulerUpdates.length} scheduler updates...`);
          
          // Chunk the concurrent updates to avoid overwhelming the connection pool
          const CHUNK_SIZE = 10;
          for (let i = 0; i < schedulerUpdates.length; i += CHUNK_SIZE) {
            const chunk = schedulerUpdates.slice(i, i + CHUNK_SIZE);
            
            await Promise.all(
              chunk.map(update =>
                db
                  .update(jobs)
                  .set({
                    scheduledJobId: update.scheduledJobId,
                    nextRunAt: update.nextRunAt,
                  })
                  .where(eq(jobs.id, update.id))
              )
            );
          }
          console.log(`[JobScheduler] Completed ${schedulerUpdates.length} scheduler updates`);
        }

        // Consider initialization successful if at least some jobs were scheduled
        // or if there were no jobs to schedule
        const success = initializedCount > 0 || (initializedCount === 0 && failedCount === 0);
        return {
          success,
          initialized: initializedCount,
          failed: failedCount,
        };
      } finally {
        // Always release the lock after we're done (success or error)
        try {
          await redisClient.del(LOCK_KEY);
          console.log('[JobScheduler] Lock released');
        } catch (unlockError) {
          console.error('[JobScheduler] Failed to release lock:', unlockError);
        }
      }
    } catch (error) {
      console.error(`Failed to initialize job schedulers (attempt ${attempt}/${maxRetries}):`, error);

      if (attempt === maxRetries) {
        return { success: false, initialized: 0, failed: 0, error };
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  // This should never be reached, but just in case
  return { success: false, initialized: 0, failed: 0 };
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
    // Create the unified data lifecycle service
    const lifecycleService = createDataLifecycleService();

    // Get Redis connection from existing queue system and initialize
    const { redisConnection } = await getQueues();
    await lifecycleService.initialize(redisConnection);

    // Set the global instance for access throughout the app
    setDataLifecycleInstance(lifecycleService);

    return lifecycleService;
  } catch (error) {
    console.error("[DATA_LIFECYCLE] ❌ Failed to initialize:", error);
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
