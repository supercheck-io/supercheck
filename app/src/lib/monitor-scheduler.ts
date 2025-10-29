import { db } from "@/utils/db";
import { monitors as monitorSchemaDb, MonitorConfig } from "@/db/schema";
import { eq, isNotNull, and, ne } from "drizzle-orm";
import { getQueues, MonitorJobData } from "./queue";

interface ScheduleMonitorOptions {
  monitorId: string;
  frequencyMinutes: number;
  jobData: MonitorJobData;
  retryLimit?: number;
}

/**
 * Creates or updates a monitor scheduler using BullMQ
 */
export async function scheduleMonitor(options: ScheduleMonitorOptions): Promise<string> {
  try {
    const { monitorSchedulerQueue } = await getQueues();
    const schedulerJobName = `scheduled-monitor-${options.monitorId}`;

    // Clean up any existing repeatable jobs for this monitor ID
    const repeatableJobs = await monitorSchedulerQueue.getRepeatableJobs();
    const existingJob = repeatableJobs.find(job =>
      job.id === options.monitorId ||
      job.key.includes(options.monitorId) ||
      job.name === schedulerJobName
    );

    if (existingJob) {
      await monitorSchedulerQueue.removeRepeatableByKey(existingJob.key);
    }

    // Create a repeatable job that follows the frequency schedule
    await monitorSchedulerQueue.add(
      schedulerJobName,
      {
        monitorId: options.monitorId,
        jobData: options.jobData,
        frequencyMinutes: options.frequencyMinutes,
        retryLimit: options.retryLimit || 3,
      },
      {
        repeat: {
          every: options.frequencyMinutes * 60 * 1000, // Convert to milliseconds
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
  } catch (error) {
    console.error(`Failed to delete scheduled monitor ${schedulerId}:`, error);
    return false;
  }
}

/**
 * Initializes monitor schedulers for all monitors with frequency
 * Called on application startup
 */
export async function initializeMonitorSchedulers(): Promise<{ success: boolean; scheduled: number; failed: number }> {
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Test Redis connection first
      const { monitorSchedulerQueue } = await getQueues();
      const redisClient = await monitorSchedulerQueue.client;
      await redisClient.ping();

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
            });
            
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
      
    } catch (error) {
      console.error(`Failed to initialize monitor schedulers (attempt ${attempt}/${maxRetries}):`, error);

      if (attempt === maxRetries) {
        return { success: false, scheduled: 0, failed: 0 };
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  // This should never be reached, but just in case
  return { success: false, scheduled: 0, failed: 0 };
}

/**
 * Cleanup function to close all monitor scheduler queues and workers.
 * Should be called when shutting down the application
 */
export async function cleanupMonitorScheduler(): Promise<boolean> {
  try {
    const { monitorSchedulerQueue } = await getQueues();
    const repeatableJobs = await monitorSchedulerQueue.getRepeatableJobs();
    
    // Get all monitors with schedules from the database
    const monitorsWithSchedules = await db
      .select({ id: monitorSchemaDb.id, scheduledJobId: monitorSchemaDb.scheduledJobId })
      .from(monitorSchemaDb)
      .where(isNotNull(monitorSchemaDb.scheduledJobId));
    
    const validMonitorIds = new Set(monitorsWithSchedules.map(m => m.id));
    const validSchedulerIds = new Set(monitorsWithSchedules.map(m => m.scheduledJobId).filter(Boolean));
    
    // Find orphaned jobs
    const orphanedJobs = repeatableJobs.filter(job => {
      const monitorIdMatch = job.name?.match(/scheduled-monitor-([0-9a-f-]+)/);
      const monitorId = monitorIdMatch ? monitorIdMatch[1] : null;
      
      return (!monitorId || !validMonitorIds.has(monitorId)) && 
             (!job.id || !validSchedulerIds.has(job.id as string));
    });
    
    if (orphanedJobs.length > 0) {
      const removePromises = orphanedJobs.map(async (job) => {
        return monitorSchedulerQueue.removeRepeatableByKey(job.key);
      });

      await Promise.all(removePromises);
    }

    return true;
  } catch (error) {
    console.error("Failed to cleanup monitor scheduler:", error);
    return false;
  }
}