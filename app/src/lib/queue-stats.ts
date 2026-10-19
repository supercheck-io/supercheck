import { checkCapacityLimits } from "@/lib/middleware/plan-enforcement";
import { db } from "@/utils/db";
import { runs, projects } from "@/db/schema";
import { eq, and, or, sql } from "drizzle-orm";

// Default capacity limits - fallback when no env vars or plan limits available
// These match the Plus plan defaults (5 running, 50 queued)
// Self-hosted mode: uses RUNNING_CAPACITY/QUEUED_CAPACITY env vars
// Cloud mode: uses plan limits from database (Plus=5/50, Pro=10/100)
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
 * Fetch real queue statistics from the database (single source of truth)
 * @param organizationId - Optional organization ID to filter by and get plan-specific capacity limits
 * 
 * This function is the SINGLE SOURCE OF TRUTH for running/queued counts.
 * It uses database run status which is maintained by:
 * - API routes (set initial status based on capacity check)
 * - Capacity manager (updates status when jobs are promoted/completed)
 */
export async function fetchQueueStats(
  organizationId?: string
): Promise<QueueStats> {
  try {
    // Get capacity limits - org-specific for cloud, env defaults for self-hosted
    const capacityLimits = await getCapacityLimitsForOrg(organizationId);

    // Query database for actual running and queued counts
    // This is the same source the executions dialog uses
    let query;
    
    if (organizationId) {
      // Organization-specific counts (for top bar/dialog)
      query = db
        .select({
          status: runs.status,
          count: sql<number>`count(*)::int`.as('count'),
        })
        .from(runs)
        .innerJoin(projects, eq(runs.projectId, projects.id))
        .where(
          and(
            eq(projects.organizationId, organizationId),
            or(
              eq(runs.status, 'running'),
              eq(runs.status, 'queued')
            )
          )
        )
        .groupBy(runs.status);
    } else {
      // Global counts (for self-hosted without auth, or fallback)
      query = db
        .select({
          status: runs.status,
          count: sql<number>`count(*)::int`.as('count'),
        })
        .from(runs)
        .where(
          or(
            eq(runs.status, 'running'),
            eq(runs.status, 'queued')
          )
        )
        .groupBy(runs.status);
    }

    const results = await query;
    
    // Extract counts from results
    let running = 0;
    let queued = 0;
    
    for (const row of results) {
      if (row.status === 'running') {
        running = row.count;
      } else if (row.status === 'queued') {
        queued = row.count;
      }
    }

    return {
      running: Math.min(running, capacityLimits.runningCapacity),
      runningCapacity: capacityLimits.runningCapacity,
      queued,
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
