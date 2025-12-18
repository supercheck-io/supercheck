/**
 * Monitor Scheduler Processor
 *
 * Handles scheduled monitor triggers. Monitors don't use the capacity
 * manager (they're lightweight checks), so this directly enqueues to
 * regional monitor queues.
 */

import { Job } from 'bullmq';
import crypto from 'crypto';
import { getQueues, queueLogger, type MonitorRegion } from '@/lib/queue';
import type { LocationConfig, MonitorConfig, MonitoringLocation } from '@/db/schema';
import { EXECUTE_MONITOR_JOB_NAME } from './constants';

const logger = queueLogger;

// Default locations for multi-region monitoring
const DEFAULT_LOCATIONS: MonitoringLocation[] = ['us-east', 'eu-central', 'asia-pacific'];

/**
 * Get effective locations based on location config
 */
function getEffectiveLocations(locationConfig: LocationConfig | null): MonitoringLocation[] {
  if (!locationConfig) {
    return DEFAULT_LOCATIONS;
  }
  
  const { locations } = locationConfig;
  if (!locations || locations.length === 0) {
    return DEFAULT_LOCATIONS;
  }
  
  return locations as MonitoringLocation[];
}

/**
 * Monitor job data structure
 */
export interface MonitorJobData {
  monitorId: string;
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

  try {
    const data = job.data;
    // Handle nested jobData structure from some trigger paths
    const executionJobData = data.jobData ?? data;
    const retryLimit = data.retryLimit || 3;

    await enqueueMonitorExecutionJobs(executionJobData, retryLimit);

    // INFO logging removed to reduce log pollution
    return { success: true };
  } catch (error) {
    logger.error(
      { monitorId, error },
      'Failed to process scheduled monitor trigger'
    );
    return { success: false };
  }
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

  // Get effective locations (multi-location monitoring)
  const effectiveLocations = getEffectiveLocations(locationConfig);
  const expectedLocations = Array.from(new Set(effectiveLocations)) as MonitoringLocation[];

  // Create execution group ID for tracking related executions
  const executionGroupId = `${jobData.monitorId}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString('hex')}`;

  // Get queue instances
  const queues = await getQueues();

  await Promise.all(
    expectedLocations.map((location) => {
      const queue = getQueueForLocation(queues.monitorExecutionQueue, location);

      return queue.add(
        EXECUTE_MONITOR_JOB_NAME,
        {
          ...jobData,
          executionLocation: location,
          executionGroupId,
          expectedLocations,
        },
        {
          jobId: `${jobData.monitorId}:${executionGroupId}:${location}`,
          attempts: retryLimit,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: COMPLETED_JOB_RETENTION,
          removeOnFail: FAILED_JOB_RETENTION,
          priority: 10,
        }
      );
    })
  );
  // INFO logging removed to reduce log pollution - monitors trigger very frequently
}

/**
 * Get the appropriate queue for a monitor location.
 * Monitors MUST run in their specified location - no fallback.
 * Location accuracy is critical for meaningful monitoring data.
 */
function getQueueForLocation(
  monitorQueues: Record<MonitorRegion, import('bullmq').Queue>,
  location: MonitoringLocation
): import('bullmq').Queue {
  const queue = monitorQueues[location as MonitorRegion];
  
  if (!queue) {
    // No fallback - monitors must run in their specified location
    throw new Error(
      `Invalid monitor location: "${location}". ` +
      `Valid locations are: us-east, eu-central, asia-pacific. ` +
      `Monitors cannot fall back to a different location as this would produce inaccurate results.`
    );
  }
  
  return queue;
}

