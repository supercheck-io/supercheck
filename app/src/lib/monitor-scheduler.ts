import { liveMonitor } from "@/lib/deletion/visibility";
import { db } from "@/utils/db";
import { monitors as monitorSchemaDb, MonitorConfig } from "@/db/schema";
import { eq, isNotNull, isNull, and, ne, inArray, gt } from "drizzle-orm";
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

/** The cadence scheduleMonitor actually registers (synthetic checks have a floor). */
function effectiveFrequencyMinutes(type: string, frequencyMinutes: number): number {
  return type === "synthetic_test" ? Math.max(frequencyMinutes, SYNTHETIC_MIN_FREQUENCY_MINUTES) : frequencyMinutes;
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
    // A monitor being deleted must never get a schedule back (trial restore, reconcile and edit paths call this).
    // Init passes `prefetched` and has already filtered deleting monitors, so it skips the lookup.
    const [deleting] = prefetched ? [] : await db.select({ id: monitorSchemaDb.id }).from(monitorSchemaDb).where(and(eq(monitorSchemaDb.id, options.monitorId), isNotNull(monitorSchemaDb.deletingAt))).limit(1);
    if (deleting) throw new Error(`Monitor ${options.monitorId} is being deleted`);
    // Backstop for the write-path check: concurrent edits (or rows saved before it) must not schedule faster checks.
    const frequencyMinutes = effectiveFrequencyMinutes(options.jobData.type, options.frequencyMinutes);

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

type MonitorRow = typeof monitorSchemaDb.$inferSelect;

/** Schedules a monitor from its row and records the scheduler id. */
async function scheduleFromRow(monitor: MonitorRow, repeatables?: RepeatableJob[]): Promise<void> {
  const schedulerId = await scheduleMonitor({
    monitorId: monitor.id,
    frequencyMinutes: monitor.frequencyMinutes!,
    jobData: {
      monitorId: monitor.id,
      projectId: monitor.projectId ?? undefined,
      type: monitor.type as MonitorJobData['type'],
      target: monitor.target,
      config: monitor.config as MonitorConfig,
      frequencyMinutes: monitor.frequencyMinutes!,
    },
    retryLimit: 3,
  }, undefined, repeatables);
  await db.update(monitorSchemaDb).set({ scheduledJobId: schedulerId }).where(eq(monitorSchemaDb.id, monitor.id));
}

const REPAIR_BATCH = 100;
const REPAIR_INTERVAL_MS = 5 * 60_000;
const REPAIR_BUDGET_MS = 45_000;
let repairCursor = ''; // last id handled, kept in memory so the next sweep starts after it
const REPAIR_LOCK_KEY = 'monitor:scheduler:init:lock'; // shared with init so the two never interleave

/**
 * Periodic repair: schedules enabled, non-paused monitors with a frequency whose schedule is lost
 * (a failed reconcile nulled scheduledJobId, or the repeatable vanished). Init only runs at startup, so
 * without this a lost schedule stays lost until the next restart. Idempotent with init: it takes the same
 * lock, only adds what is missing, and handles at most REPAIR_BATCH monitors per sweep.
 */
export async function repairMonitorSchedules(): Promise<{ repaired: number; failed: number }> {
  const { monitorSchedulerQueue } = await getQueues();
  const redisClient = (await monitorSchedulerQueue.client) as unknown as Redis;
  const lockToken = `${process.pid}:${randomUUID()}`;
  if (!(await redisClient.set(REPAIR_LOCK_KEY, lockToken, 'EX', 60, 'NX'))) return { repaired: 0, failed: 0 };
  try {
    const repeatables = await monitorSchedulerQueue.getRepeatableJobs();
    const scheduled = new Set(repeatables.map((job) => job.name?.match(/^scheduled-monitor-([0-9a-f-]+)$/)?.[1]));
    const active = await db
      .select({ id: monitorSchemaDb.id, scheduledJobId: monitorSchemaDb.scheduledJobId })
      .from(monitorSchemaDb)
      .where(and(gt(monitorSchemaDb.frequencyMinutes, 0), eq(monitorSchemaDb.enabled, true), ne(monitorSchemaDb.status, 'paused'), liveMonitor(monitorSchemaDb)))
      .orderBy(monitorSchemaDb.id);
    // Never-scheduled monitors first; within each group continue after the last id of the previous sweep,
    // so rows that keep failing cannot starve the rest of the batch.
    const needsRepair = active.filter((row) => row.scheduledJobId == null || !scheduled.has(row.id));
    const rotate = (rows: typeof needsRepair) => {
      const at = rows.findIndex((row) => row.id > repairCursor);
      return at < 0 ? rows : [...rows.slice(at), ...rows.slice(0, at)];
    };
    const missing = [
      ...rotate(needsRepair.filter((row) => row.scheduledJobId == null)),
      ...rotate(needsRepair.filter((row) => row.scheduledJobId != null)),
    ].slice(0, REPAIR_BATCH);
    let repaired = 0;
    let failed = 0;
    const startedAt = Date.now();
    let processed = 0;
    for (const { id } of missing) {
      if (Date.now() - startedAt >= REPAIR_BUDGET_MS) break; // the lock TTL is 60s: stop well inside it
      processed++;
      repairCursor = id;
      try {
        // Re-read: an edit or pause since the list must win.
        const [monitor] = await db.select().from(monitorSchemaDb).where(eq(monitorSchemaDb.id, id));
        if (!monitor || !monitor.enabled || monitor.status === 'paused' || !monitor.frequencyMinutes) continue;
        await scheduleFromRow(monitor, repeatables);
        repaired++;
      } catch (error) {
        console.error(`[MonitorScheduler] Repair failed for monitor ${id}:`, error);
        failed++;
      }
    }
    const left = needsRepair.length - processed;
    if (left > 0) console.warn(`[MonitorScheduler] Repair sweep stopped with ${left} monitor(s) left for the next sweep`);
    if (repaired > 0 || failed > 0) console.log(`[MonitorScheduler] Repair sweep rescheduled ${repaired} monitor(s), ${failed} failed`);
    return { repaired, failed };
  } finally {
    await redisClient
      .eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, REPAIR_LOCK_KEY, lockToken)
      .catch((unlockError: unknown) => console.error('[MonitorScheduler] Failed to release repair lock:', unlockError));
  }
}

/** Starts the repair sweep once per process (survives hot reload). */
export function startMonitorScheduleRepair(): void {
  const state = globalThis as { __monitorRepairTimer?: ReturnType<typeof setInterval> };
  if (state.__monitorRepairTimer) return;
  state.__monitorRepairTimer = setInterval(() => {
    repairMonitorSchedules().catch((error) => console.error('[MonitorScheduler] Repair sweep failed:', error));
  }, REPAIR_INTERVAL_MS);
  state.__monitorRepairTimer.unref?.();
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
      const lockedAt = Date.now();
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
            ne(monitorSchemaDb.status, 'paused'),
            liveMonitor(monitorSchemaDb)
          ));

        if (activeMonitors.length === 0) {
          return { success: true, scheduled: 0, failed: 0 };
        }

        let scheduledCount = 0;
        let failedCount = 0;

        const RENEW_EVERY_MS = 30_000;
        let lockLost = false;
        let lastRenewal = lockedAt;
        for (const [index, listed] of activeMonitors.entries()) {
          // The 120s lock outlives a normal sync, but a large fleet can exceed it: extend it while
          // still the owner, and stop if another replica has taken over.
          if (Date.now() - lastRenewal >= RENEW_EVERY_MS) {
            const renewed = await redisClient.eval(
              "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
              1, LOCK_KEY, lockToken, LOCK_TTL_SECONDS,
            );
            if (!renewed) {
              const unprocessed = activeMonitors.length - index;
              console.error(`[MonitorScheduler] Init lock lost mid-sync; stopping with ${unprocessed} monitor(s) unscheduled so a newer sync owns the queue`);
              failedCount += unprocessed;
              lockLost = true;
              break;
            }
            lastRenewal = Date.now();
          }
          // The list was read before the loop: a frequency/pause/delete edit since then must win,
          // so schedule from the current row, never the listed one.
          const [monitor] = await db.select().from(monitorSchemaDb).where(eq(monitorSchemaDb.id, listed.id));
          if (!monitor || !monitor.enabled || monitor.status === 'paused' || !monitor.frequencyMinutes) continue;
          if (monitor.frequencyMinutes > 0) {
            try {
            
              await scheduleFromRow(monitor, repeatables);

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
        const success = !lockLost && (scheduledCount > 0 || (scheduledCount === 0 && failedCount === 0));
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
 * A repeatable at the monitor's current cadence is never removed (a monitor created
 * mid-rollout may not have its scheduledJobId written yet); extra or stale-cadence ones are. Runs under the init lock.
 * A paused monitor resumed concurrently is not lost: resume commits its status before re-adding the repeatable, and
 * init reads active monitors only after these removals and re-schedules them.
 */
async function removeOrphanedMonitorRepeatables(queue: Queue): Promise<RepeatableJob[]> {
  const repeatableJobs = await queue.getRepeatableJobs();
  const monitorIdOf = (job: { name?: string | null }) =>
    job.name?.match(/^scheduled-monitor-([0-9a-f-]+)$/)?.[1];
  const monitorIds = [...new Set(repeatableJobs.map(monitorIdOf).filter((id): id is string => !!id))];
  if (monitorIds.length === 0) return repeatableJobs;

  const rows = await db
    .select({ id: monitorSchemaDb.id, enabled: monitorSchemaDb.enabled, status: monitorSchemaDb.status, scheduledJobId: monitorSchemaDb.scheduledJobId, type: monitorSchemaDb.type, frequencyMinutes: monitorSchemaDb.frequencyMinutes })
    .from(monitorSchemaDb)
    .where(inArray(monitorSchemaDb.id, monitorIds));
  const monitorsById = new Map(rows.map((row) => [row.id, row]));

  // An enabled monitor keeps one repeatable at its current cadence. A frequency edit that raced a
  // sync leaves an extra one at the old cadence (a different key), which would double its checks.
  const cadenceOk = (job: RepeatableJob, monitor: { type: string; frequencyMinutes: number | null }) =>
    !job.pattern && !!monitor.frequencyMinutes && Number(job.every) === effectiveFrequencyMinutes(monitor.type, monitor.frequencyMinutes) * 60_000;
  // Extras go only when a correct-cadence repeatable stays: removing a lone stale one would leave the
  // monitor unscheduled if init then died; scheduleMonitor replaces it instead.
  const keeper = new Map<string, RepeatableJob>();
  for (const job of repeatableJobs) {
    const monitorId = monitorIdOf(job);
    const monitor = monitorId ? monitorsById.get(monitorId) : undefined;
    if (monitorId && monitor && !keeper.has(monitorId) && cadenceOk(job, monitor)) keeper.set(monitorId, job);
  }
  const orphanedJobs = repeatableJobs.filter((job) => {
    const monitorId = monitorIdOf(job);
    if (!monitorId) return false;
    const monitor = monitorsById.get(monitorId);
    if (!monitor || !monitor.enabled || monitor.status === "paused" || (monitor.scheduledJobId != null && monitor.scheduledJobId !== monitorId)) return true;
    return keeper.has(monitorId) && keeper.get(monitorId) !== job;
  });
  await Promise.all(orphanedJobs.map((job) => queue.removeRepeatableByKey(job.key)));
  return repeatableJobs.filter((job) => !orphanedJobs.includes(job));
}
