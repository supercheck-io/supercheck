import { getQueues } from "@/lib/queue";
import { checkCapacityLimits } from "@/lib/middleware/plan-enforcement";

// Default capacity limits - used as fallback for self-hosted mode
export const DEFAULT_RUNNING_CAPACITY = parseInt(
  process.env.RUNNING_CAPACITY || "5"
);
export const DEFAULT_QUEUED_CAPACITY = parseInt(
  process.env.QUEUED_CAPACITY || "50"
);

export interface QueueStats {
  running: number;
  runningCapacity: number;
  queued: number;
  queuedCapacity: number;
}

export interface CapacityLimits {
  runningCapacity: number;
  queuedCapacity: number;
}

/**
 * Get capacity limits for an organization based on their subscription plan
 * For self-hosted mode, uses environment defaults
 * For cloud mode, fetches plan-specific limits from database
 *
 * Note: This function is called frequently (every 1s for SSE), so we don't log
 * on every call to avoid polluting logs. The checkCapacityLimits function
 * handles the fallback gracefully.
 */
export async function getCapacityLimitsForOrg(
  organizationId?: string
): Promise<CapacityLimits> {
  if (!organizationId) {
    // No org context - use defaults (self-hosted or unauthenticated)
    return {
      runningCapacity: DEFAULT_RUNNING_CAPACITY,
      queuedCapacity: DEFAULT_QUEUED_CAPACITY,
    };
  }

  try {
    // checkCapacityLimits handles both self-hosted (env vars) and cloud (plan limits)
    // It now returns defaults gracefully for unsubscribed users without throwing
    return await checkCapacityLimits(organizationId);
  } catch {
    // Only log unexpected errors (not subscription-related)
    // checkCapacityLimits now handles subscription errors internally
    if (process.env.NODE_ENV === "development") {
      console.debug(
        `[queue-stats] Using default capacity for org ${organizationId.substring(0, 8)}...`
      );
    }
    return {
      runningCapacity: DEFAULT_RUNNING_CAPACITY,
      queuedCapacity: DEFAULT_QUEUED_CAPACITY,
    };
  }
}

const COUNT_STATUSES = [
  "active",
  "waiting",
  "prioritized",
  "paused",
  "delayed",
] as const;

/**
 * Check if a job should be processed based on current queue stats
 * This ensures workers only process jobs that are within the running capacity
 * Returns true only if we're below running capacity, false if we're at/above capacity
 */
export async function shouldProcessJob(): Promise<boolean> {
  const stats = await fetchQueueStats();
  return stats.running < stats.runningCapacity;
}

/**
 * Fetch real queue statistics from Redis using BullMQ key patterns
 * @param organizationId - Optional organization ID to get plan-specific capacity limits
 */
export async function fetchQueueStats(
  organizationId?: string
): Promise<QueueStats> {
  try {
    // Get capacity limits - org-specific for cloud, env defaults for self-hosted
    const capacityLimits = await getCapacityLimitsForOrg(organizationId);

    const queues = await getQueues();

    // Aggregate all execution queues
    const executionQueues = [
      // Playwright global queue
      {
        name: "playwright-global",
        queue: queues.playwrightQueues["global"],
      },
      // K6 Regional Queues
      ...Object.entries(queues.k6Queues).map(([region, queue]) => ({
        name: `k6-${region}`,
        queue,
      })),
      // Monitor queues are excluded from running capacity limits as they are critical
      // and should not be blocked by long-running tests
    ];

    const countsByQueue = await Promise.all(
      executionQueues.map(async ({ name, queue }) => {
        if (!queue) {
          console.warn(
            `[Queue Stats] Queue "${name}" is not initialized; counting as zero.`
          );
          return { name, counts: null };
        }

        try {
          const counts = await queue.getJobCounts(...COUNT_STATUSES);
          return { name, counts };
        } catch (error) {
          console.error(
            `[Queue Stats] Failed to fetch counts for ${name}:`,
            error instanceof Error ? error.message : String(error)
          );
          return { name, counts: null };
        }
      })
    );

    const totals = countsByQueue.reduce(
      (acc, { counts }) => {
        if (!counts) {
          return acc;
        }

        acc.running += counts.active ?? 0;
        acc.queued +=
          (counts.waiting ?? 0) +
          (counts.prioritized ?? 0) +
          (counts.paused ?? 0) +
          (counts.delayed ?? 0);

        return acc;
      },
      { running: 0, queued: 0 }
    );

    return {
      running: Math.min(totals.running, capacityLimits.runningCapacity),
      runningCapacity: capacityLimits.runningCapacity,
      queued: totals.queued,
      queuedCapacity: capacityLimits.queuedCapacity,
    };
  } catch (error) {
    console.error(
      "Error fetching queue stats:",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

/**
 * Generate mock queue statistics for development or when Redis is unavailable
 */
export function generateMockQueueStats(): QueueStats {
  // Generate semi-realistic mock data
  const timestamp = Date.now();

  // Make running jobs fluctuate over time but with realistic distribution
  const timeOfDay = Math.floor((timestamp % 86400000) / 3600000); // 0-23 based on hour of day

  // More threads during business hours (8-18), fewer at night
  let loadFactor = 0.3;
  if (timeOfDay >= 8 && timeOfDay <= 18) {
    loadFactor = 0.6 + Math.sin(((timeOfDay - 8) / 10) * Math.PI) * 0.3; // Peak at ~1pm
  }

  // Calculate running threads based on load factor
  const runningBase = Math.floor(DEFAULT_RUNNING_CAPACITY * loadFactor);
  const runningNoise = Math.floor(Math.random() * 10) - 5; // -5 to +5 noise
  const running = Math.min(
    DEFAULT_RUNNING_CAPACITY,
    Math.max(1, runningBase + runningNoise)
  ); // Ensure at least 1

  // Only show queued if we're at capacity
  let queued = 0;
  if (running >= DEFAULT_RUNNING_CAPACITY * 0.95) {
    // Near capacity, some queuing
    const queuedBase = Math.floor(Math.random() * 20); // 0-20 range for queued
    queued = queuedBase;
  }

  return {
    running,
    runningCapacity: DEFAULT_RUNNING_CAPACITY,
    queued,
    queuedCapacity: DEFAULT_QUEUED_CAPACITY,
  };
}

/**
 * Get queue statistics with fallback to zeros
 * @param organizationId - Optional organization ID to get plan-specific capacity limits
 */
export async function getQueueStats(
  organizationId?: string
): Promise<QueueStats> {
  try {
    return await fetchQueueStats(organizationId);
  } catch (error) {
    console.error(
      "Error fetching real queue stats:",
      error instanceof Error ? error.message : String(error)
    );
    // Return zeros with default capacity on error
    const defaultLimits = await getCapacityLimitsForOrg(organizationId);
    return {
      running: 0,
      runningCapacity: defaultLimits.runningCapacity,
      queued: 0,
      queuedCapacity: defaultLimits.queuedCapacity,
    };
  }
}
