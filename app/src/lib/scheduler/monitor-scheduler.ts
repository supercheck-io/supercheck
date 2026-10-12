/**
 * Monitor Scheduler Processor
 *
 * Handles scheduled monitor triggers. Monitors don't use the capacity
 * manager (they're lightweight checks), so this directly enqueues to
 * regional monitor queues.
 */

import { Job } from 'bullmq';
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

const logger = queueLogger;

/**
 * Monitor job data structure
 */
export interface MonitorJobData {
  monitorId: string;
  projectId?: string;
  type: 'http_request' | 'website' | 'ping_host' | 'port_check';
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
  const executionJobData = data.jobData ?? data;
  const retryLimit = data.retryLimit || 3;

  try {
    await enqueueMonitorExecutionJobs(executionJobData, retryLimit);
  } catch (error) {
    // Record every enqueue failure so the monitor cannot remain falsely up.
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
  retryLimit: number
): Promise<void> {
  const monitorConfig = jobData.config;
  const locationConfig = monitorConfig?.locationConfig as LocationConfig | null ?? null;

  // Get effective locations (multi-location monitoring) - now async
  const effectiveLocations = await resolveMonitorLocations(locationConfig, jobData.projectId);
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
    throw new Error(
      `Monitor ${jobData.monitorId}: no jobs enqueued — none of the expected locations ` +
      `[${expectedLocations.join(', ')}] have live workers. Check worker health and location configuration.`
    );
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
      priority: 10,
    }
  );
}
