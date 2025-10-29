import { Queue } from "bullmq";
import { JOB_EXECUTION_QUEUE } from "@/lib/queue";

// Default capacity limits - enforced at both API and worker level
export const RUNNING_CAPACITY = parseInt(process.env.RUNNING_CAPACITY || "5");

/**
 * Maximum number of jobs that can be queued.
 * This is a hard limit enforced at the API layer - new submissions will be rejected
 * with a 429 (Too Many Requests) status code once this limit is reached.
 */
export const QUEUED_CAPACITY = parseInt(process.env.QUEUED_CAPACITY || "50");

export interface QueueStats {
  running: number;
  runningCapacity: number;
  queued: number;
  queuedCapacity: number;
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
 * Fetch real queue statistics from Redis using BullMQ key patterns
 */
export async function fetchQueueStats(): Promise<QueueStats> {
  // Set up Redis connection
  const host = process.env.REDIS_HOST || "localhost";
  const port = parseInt(process.env.REDIS_PORT || "6379");
  const password = process.env.REDIS_PASSWORD;

  const queue = new Queue(JOB_EXECUTION_QUEUE, {
    connection: {
      host,
      port,
      password: password || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 3000,
    },
  });

  try {
    const counts = await queue.getJobCounts(
      "active",
      "waiting",
      "prioritized",
      "paused",
      "delayed"
    );

    const runningCount = Math.min(counts.active ?? 0, RUNNING_CAPACITY);
    const queuedCount =
      (counts.waiting ?? 0) +
      (counts.prioritized ?? 0) +
      (counts.paused ?? 0) +
      (counts.delayed ?? 0);

    return {
      running: runningCount,
      runningCapacity: RUNNING_CAPACITY,
      queued: queuedCount,
      queuedCapacity: QUEUED_CAPACITY,
    };
  } catch (error) {
    console.error(
      "Error fetching queue stats:",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  } finally {
    await queue.close().catch(() => {
      // Ignore errors during shutdown
    });
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
  const runningBase = Math.floor(RUNNING_CAPACITY * loadFactor);
  const runningNoise = Math.floor(Math.random() * 10) - 5; // -5 to +5 noise
  const running = Math.min(
    RUNNING_CAPACITY,
    Math.max(1, runningBase + runningNoise)
  ); // Ensure at least 1

  // Only show queued if we're at capacity
  let queued = 0;
  if (running >= RUNNING_CAPACITY * 0.95) {
    // Near capacity, some queuing
    const queuedBase = Math.floor(Math.random() * 20); // 0-20 range for queued
    queued = queuedBase;
  }

  return {
    running,
    runningCapacity: RUNNING_CAPACITY,
    queued,
    queuedCapacity: QUEUED_CAPACITY,
  };
}

/**
 * Get queue statistics with fallback to zeros
 */
export async function getQueueStats(): Promise<QueueStats> {
  try {
    return await fetchQueueStats();
  } catch (error) {
    console.error(
      "Error fetching real queue stats:",
      error instanceof Error ? error.message : String(error)
    );
    // Return zeros rather than mock data
    return {
      running: 0,
      runningCapacity: RUNNING_CAPACITY,
      queued: 0,
      queuedCapacity: QUEUED_CAPACITY,
    };
  }
}
