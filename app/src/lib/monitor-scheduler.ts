import { db } from "@/utils/db";
import { monitors as monitorSchemaDb, MonitorConfig } from "@/db/schema";
import { eq, isNotNull, and, ne, inArray } from "drizzle-orm";
import { getQueues, MonitorJobData } from "./queue";
import { SYNTHETIC_MIN_FREQUENCY_MINUTES } from "./monitor-write";
import type { Redis } from "ioredis";
import type { Queue, RepeatableJob } from "bullmq";
import { randomUUID } from "crypto";

interface ScheduleMonitorOptions {
  monitorId: string;
  frequencyMinutes: number;
  jobData: MonitorJobData;
  retryLimit?: number;
}

/**
 * Creates or updates a monitor scheduler using BullMQ
 */
export async function scheduleMonitor(
  options: ScheduleMonitorOptions,
  signal?: AbortSignal,
  // Init passes the repeatables it fetched once instead of rescanning the queue per monitor.
  prefetched?: RepeatableJob[]
): Promise<string> {
  try {
    const { monitorSchedulerQueue } = await getQueues();
    const schedulerJobName = `scheduled-monitor-${options.monitorId}`;
    // Backstop for the write-path check: concurrent edits (or rows saved before it) must not schedule faster checks.
    const frequencyMinutes =
      options.jobData.type === "synthetic_test"
        ? Math.max(options.frequencyMinutes, SYNTHETIC_MIN_FREQUENCY_MINUTES)
        : options.frequencyMinutes;

    // Clean up ALL existing repeatable jobs for this monitor ID
    // Using .filter() instead of .find() to remove ALL matching jobs,
    // preventing accumulated schedules from causing multiple triggers
    const repeatableJobs = prefetched ?? (await monitorSchedulerQueue.getRepeatableJobs());
    const existingJobs = repeatableJobs.filter(job =>
      job.id === options.monitorId ||
      job.key.includes(options.monitorId) ||
      job.name === schedulerJobName
    );

    // An aborted (timed-out) caller must not mutate the queue after it gave up: a newer reconcile owns it now.
    signal?.throwIfAborted();
    if (existingJobs.length > 0) {
      await Promise.all(
        existingJobs.map(job => monitorSchedulerQueue.removeRepeatableByKey(job.key))
      );
    }

    signal?.throwIfAborted();
    // Create a repeatable job that follows the frequency schedule
    await monitorSchedulerQueue.add(
      schedulerJobName,
      {
        monitorId: options.monitorId,
        jobData: options.jobData,
        frequencyMinutes,
        retryLimit: options.retryLimit || 3,
      },
      {
        repeat: {
          every: frequencyMinutes * 60 * 1000, // Convert to milliseconds
        },
        removeOnComplete: true,
        removeOnFail: 100,
        jobId: schedulerJobName,
      }
    );

    return options.monitorId;
  } catch (error) {
    console.error(`Failed to schedule monitor:`, error);
    throw error;
  }
}

/**
 * Deletes a monitor scheduler
 */
export async function deleteScheduledMonitor(schedulerId: string): Promise<boolean> {
  try {
    return await removeScheduledMonitor(schedulerId);
  } catch (error) {
    console.error("Failed to delete scheduled monitor %s:", schedulerId, error);
    return false;
  }
}

/**
 * Like deleteScheduledMonitor, but a scheduler failure throws instead of reading as "nothing to delete".
 * Returns whether a job was found; an absent job is not an error.
 */
export async function removeScheduledMonitor(schedulerId: string, signal?: AbortSignal): Promise<boolean> {
  {
    const { monitorSchedulerQueue } = await getQueues();
    const repeatableJobs = await monitorSchedulerQueue.getRepeatableJobs();
    const schedulerJobName = `scheduled-monitor-${schedulerId}`;

    console.log(`[DELETE_MONITOR] Attempting to delete scheduled monitor: ${schedulerId}`);
    console.log(`[DELETE_MONITOR] Found ${repeatableJobs.length} total repeatable jobs in queue`);

    const jobsToRemove = repeatableJobs.filter(job =>
      job.id === schedulerId ||
      job.key.includes(schedulerId) ||
      job.name === schedulerJobName ||
      job.key.includes(schedulerJobName)
    );

    signal?.throwIfAborted(); // a timed-out caller must not delete a schedule a later resume re-created
    if (jobsToRemove.length > 0) {
      console.log(`[DELETE_MONITOR] Found ${jobsToRemove.length} jobs to remove for monitor ${schedulerId}:`, jobsToRemove.map(j => ({ key: j.key, name: j.name, id: j.id })));

      const removePromises = jobsToRemove.map(async (job) => {
        console.log(`[DELETE_MONITOR] Removing job with key: ${job.key}`);
        return monitorSchedulerQueue.removeRepeatableByKey(job.key);
      });

      await Promise.all(removePromises);
      console.log(`[DELETE_MONITOR] Successfully removed ${jobsToRemove.length} scheduled jobs for monitor ${schedulerId}`);
      return true;
    } else {
      console.warn(`[DELETE_MONITOR] No scheduled jobs found for monitor ${schedulerId} (searched for ID: ${schedulerId}, name: ${schedulerJobName})`);
      return false;
    }
  }
}

/**
 * Initializes monitor schedulers for all monitors with frequency
 * Called on application startup.
 * Uses a distributed lock to prevent race conditions in clustered environments.
 */
export async function initializeMonitorSchedulers(): Promise<{ success: boolean; scheduled: number; failed: number }> {
  const maxRetries = 3;
  const baseRetryDelay = 2000; // 2 seconds, doubles each attempt
  const LOCK_KEY = 'monitor:scheduler:init:lock';
  const LOCK_TTL_SECONDS = 120; // 2 minutes - enough time to initialize all schedulers
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Test Redis connection first
      const { monitorSchedulerQueue } = await getQueues();
      const redisClient = (await monitorSchedulerQueue.client) as unknown as Redis;
      await redisClient.ping();

      // Acquire distributed lock to prevent multiple instances from initializing simultaneously
      // This is critical in clustered deployments where multiple Next.js instances start together
      const lockToken = `${process.pid}:${randomUUID()}`;
      const lockAcquired = await redisClient.set(LOCK_KEY, lockToken, 'EX', LOCK_TTL_SECONDS, 'NX');
      
      if (!lockAcquired) {
        console.log('[MonitorScheduler] Another instance is initializing schedulers, skipping...');
        return { success: true, scheduled: 0, failed: 0 };
      }
      
      console.log('[MonitorScheduler] Lock acquired, initializing schedulers...');

      try {
        let repeatables: RepeatableJob[] | undefined;
        try {
          repeatables = await removeOrphanedMonitorRepeatables(monitorSchedulerQueue);
        } catch (cleanupError) {
          console.error('Failed to clean up orphaned monitor repeatables:', cleanupError);
        }

        const activeMonitors = await db
          .select()
          .from(monitorSchemaDb)
          .where(and(
            isNotNull(monitorSchemaDb.frequencyMinutes),
            eq(monitorSchemaDb.enabled, true),
            ne(monitorSchemaDb.status, 'paused')
          ));

        if (activeMonitors.length === 0) {
          return { success: true, scheduled: 0, failed: 0 };
        }

        let scheduledCount = 0;
        let failedCount = 0;

        for (const monitor of activeMonitors) {
          if (monitor.frequencyMinutes && monitor.frequencyMinutes > 0) {
            try {
            
              const jobDataPayload: MonitorJobData = {
                monitorId: monitor.id,
                projectId: monitor.projectId ?? undefined,
                type: monitor.type as MonitorJobData['type'],
                target: monitor.target,
                config: monitor.config as MonitorConfig,
                frequencyMinutes: monitor.frequencyMinutes,
              };

              const schedulerId = await scheduleMonitor({
                monitorId: monitor.id,
                frequencyMinutes: monitor.frequencyMinutes,
                jobData: jobDataPayload,
                retryLimit: 3
              }, undefined, repeatables);
            
              // Update the monitor with the scheduler ID (like jobs do)
              await db
                .update(monitorSchemaDb)
                .set({ scheduledJobId: schedulerId })
                .where(eq(monitorSchemaDb.id, monitor.id));

              scheduledCount++;
            } catch (error) {
              console.error(`Failed to initialize monitor scheduler ${monitor.id}:`, error);
              failedCount++;
            }
          } else {
            failedCount++;
          }
        }
      
        // Consider initialization successful if at least some monitors were scheduled
        // or if there were no monitors to schedule
        const success = scheduledCount > 0 || (scheduledCount === 0 && failedCount === 0);
        return { success, scheduled: scheduledCount, failed: failedCount };
      } finally {
        // Compare-and-delete: the TTL may have expired and another instance taken over.
        await redisClient
          .eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, LOCK_KEY, lockToken)
          .catch((unlockError: unknown) => console.error('[MonitorScheduler] Failed to release lock:', unlockError));
      }
    } catch (error) {
      console.error(`Failed to initialize monitor schedulers (attempt ${attempt}/${maxRetries}):`, error);

      if (attempt === maxRetries) {
        return { success: false, scheduled: 0, failed: 0 };
      }

      // Wait before retrying with exponential backoff
      await new Promise(resolve => setTimeout(resolve, baseRetryDelay * Math.pow(2, attempt - 1)));
    }
  }
  
  // This should never be reached, but just in case
  return { success: false, scheduled: 0, failed: 0 };
}

/**
 * Removes repeatables whose monitor is deleted, disabled or scheduled under a different id.
 * A repeatable for an existing enabled monitor is never removed: a monitor created
 * mid-rollout may not have its scheduledJobId written yet. Runs under the init lock.
 */
async function removeOrphanedMonitorRepeatables(queue: Queue): Promise<RepeatableJob[]> {
  const repeatableJobs = await queue.getRepeatableJobs();
  const monitorIdOf = (job: { name?: string | null }) =>
    job.name?.match(/^scheduled-monitor-([0-9a-f-]+)$/)?.[1];
  const monitorIds = [...new Set(repeatableJobs.map(monitorIdOf).filter((id): id is string => !!id))];
  if (monitorIds.length === 0) return repeatableJobs;

  const rows = await db
    .select({ id: monitorSchemaDb.id, enabled: monitorSchemaDb.enabled, status: monitorSchemaDb.status, scheduledJobId: monitorSchemaDb.scheduledJobId })
    .from(monitorSchemaDb)
    .where(inArray(monitorSchemaDb.id, monitorIds));
  const monitorsById = new Map(rows.map((row) => [row.id, row]));

  const orphanedJobs = repeatableJobs.filter((job) => {
    const monitorId = monitorIdOf(job);
    if (!monitorId) return false;
    const monitor = monitorsById.get(monitorId);
    return !monitor || !monitor.enabled || monitor.status === "paused" || (monitor.scheduledJobId != null && monitor.scheduledJobId !== monitorId);
  });
  await Promise.all(orphanedJobs.map((job) => queue.removeRepeatableByKey(job.key)));
  return repeatableJobs.filter((job) => !orphanedJobs.includes(job));
}
