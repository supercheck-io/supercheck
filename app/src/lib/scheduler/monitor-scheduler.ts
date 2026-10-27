/**
 * Monitor Scheduler Processor
 *
 * Handles scheduled monitor triggers. Monitors don't use the capacity
 * manager (they're lightweight checks), so this directly enqueues to
 * regional monitor queues.
 */

import { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '@/utils/db';
import { monitors } from '@/db/schema';
import {
  getQueues,
  monitorQueueName,
  enqueueMonitorLocationJobs,
  queueLogger,
} from '@/lib/queue';
import type { LocationConfig, MonitorConfig, MonitoringLocation } from '@/db/schema';
import {
  partitionMonitorLocationsByAvailability,
  resolveMonitorLocations,
} from '@/lib/monitor-location-routing';

import { recordSchedulingFailure } from '@/lib/monitor-scheduling-failure';
import { NoLiveWorkersError } from '@/lib/no-live-workers-error';
import {
  abortMonitorCycle,
  MonitorCycleClosedError,
  missingCycleClosureEnabled,
  monitorCycleId,
  monitorCyclePolicy,
} from '@/lib/monitor-cycles';

const logger = queueLogger;

/**
 * Monitor job data structure
 */
export interface MonitorJobData {
  monitorId: string;
  projectId?: string;
  type: 'http_request' | 'website' | 'ping_host' | 'port_check' | 'synthetic_test';
  target: string;
  config?: MonitorConfig;
  frequencyMinutes?: number;
  executionLocation?: MonitoringLocation;
  executionGroupId?: string;
  expectedLocations?: MonitoringLocation[];
  retryLimit?: number;
  jobData?: MonitorJobData;
}

// Job retention settings
const COMPLETED_JOB_RETENTION = { count: 500, age: 24 * 3600 };
const FAILED_JOB_RETENTION = { count: 1000, age: 7 * 24 * 3600 };

/**
 * Process a scheduled monitor trigger
 */
export async function processScheduledMonitor(
  job: Job<MonitorJobData>
): Promise<{ success: boolean }> {
  const monitorId = job.data.monitorId;

  const data = job.data;
  // Handle nested jobData structure from some trigger paths
  let executionJobData = data.jobData ?? data;
  const retryLimit = data.retryLimit || 3;

  const finalAttempt = job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
  // Read outside the try: a database failure here says nothing about the monitored service, so it
  // must surface to BullMQ for a retry and not be recorded as the monitor being down.
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { config: true, target: true, type: true, projectId: true, frequencyMinutes: true, enabled: true, status: true },
  });
  if (!monitor || monitor.enabled === false || monitor.status === 'paused') {
    // A deleted monitor still firing means the schedule delete after commit failed, so remove this job's
    // own repeatable schedule. Best effort: a later firing retries. Paused monitors are left alone: resume
    // re-adds the same repeat key, so removing here could race a resume and unschedule a live monitor.
    if (!monitor && job.repeatJobKey) {
      try {
        const { monitorSchedulerQueue } = await getQueues();
        await monitorSchedulerQueue.removeRepeatableByKey(job.repeatJobKey);
      } catch (error) {
        logger.warn({ err: error, monitorId }, 'Unable to remove stale monitor schedule');
      }
    }
    return { success: false };
  }
  try {
    executionJobData = {
      ...executionJobData,
      target: monitor.target,
      type: monitor.type,
      projectId: monitor.projectId ?? undefined,
      frequencyMinutes: monitor.frequencyMinutes,
      config: monitor.config ?? undefined,
    };
    await enqueueMonitorExecutionJobs(executionJobData, retryLimit, {
      // Retries of one scheduled cycle share the scheduler job id, hence one durable cycle.
      key: job.id,
      finalAttempt,
    });
  } catch (error) {
    if (error instanceof MonitorCycleClosedError) {
      // The cycle already closed (deadline passed while publication kept failing). Publishing now
      // would discard every result, and a second scheduling failure would double count the outage.
      logger.warn(
        { monitorId: executionJobData.monitorId, cycleId: error.cycleId },
        'Skipping publication into an already closed monitor cycle',
      );
      return { success: false };
    }
    // Failures before publication (no live workers, routing, queue lookup) can leave a cycle from an
    // earlier attempt open with no jobs; with no retry left it must not close as missing-region downtime.
    if (finalAttempt && job.id && missingCycleClosureEnabled()) {
      await abortMonitorCycle(
        monitorCycleId(executionJobData.monitorId, job.id),
      ).catch((abortError) =>
        logger.warn({ err: abortError }, 'Unable to abort monitor cycle'),
      );
    }
    if (error instanceof NoLiveWorkersError) {
      // Worker absence is not monitor downtime; skip the cycle, but rethrow so BullMQ retries
      // while workers may come back. Sustained absence is for worker-health alerting.
      logger.warn(
        { monitorId: error.monitorId, expectedLocations: error.expectedLocations },
        'Skipping monitor cycle: no live workers in any expected location',
      );
      throw error;
    }
    // Record every other enqueue failure so the monitor cannot remain falsely up.
    const errorMessage = error instanceof Error ? error.message : String(error);
    await recordSchedulingFailure(executionJobData.monitorId, errorMessage);
    throw error; // Re-throw so BullMQ marks the scheduler job as failed
  }

  return { success: true };
}

/**
 * Enqueue monitor execution jobs to regional queues
 */
async function enqueueMonitorExecutionJobs(
  jobData: MonitorJobData,
  retryLimit: number,
  cycle: { key?: string; finalAttempt: boolean }
): Promise<void> {
  const monitorConfig = jobData.config;
  const locationConfig = monitorConfig?.locationConfig as LocationConfig | null ?? null;

  // Get effective locations (multi-location monitoring) - now async
  const effectiveLocations = await resolveMonitorLocations(locationConfig, jobData.projectId, {
    monitorType: jobData.type,
  });
  const expectedLocations = Array.from(new Set(effectiveLocations));

  // Get queue instances
  const queues = await getQueues();

  // First pass: determine which locations have active queues
  const { enqueuedLocations, skippedLocations } =
    await partitionMonitorLocationsByAvailability(
      expectedLocations,
      Object.keys(queues.monitorExecutionQueue),
      monitorQueueName
    );

  if (enqueuedLocations.length === 0 && expectedLocations.length > 0) {
    throw new NoLiveWorkersError(jobData.monitorId, expectedLocations);
  }

  if (skippedLocations.length > 0) {
    logger.warn(
      {
        monitorId: jobData.monitorId,
        skippedLocations,
        enqueuedLocations,
      },
      `Monitor ${jobData.monitorId}: ${skippedLocations.length} location(s) skipped ` +
      `due to missing/offline workers. Aggregation will proceed with ${enqueuedLocations.length} location(s).`
    );
  }

  await enqueueMonitorLocationJobs(
    queues.monitorExecutionQueue, jobData, enqueuedLocations,
    {
      attempts: retryLimit,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: COMPLETED_JOB_RETENTION,
      removeOnFail: FAILED_JOB_RETENTION,
      // No BullMQ priority: prioritized jobs live in the `:prioritized` sorted set,
      // which KEDA's redis list triggers cannot see. Scheduled checks queue FIFO in
      // `:wait`; immediate runs use lifo to go ahead of them (see queue.ts).
    },
    {
      key: cycle.key,
      configuredLocations: expectedLocations,
      policy: monitorCyclePolicy(locationConfig),
      abortOnFailure: cycle.finalAttempt,
    }
  );
}
