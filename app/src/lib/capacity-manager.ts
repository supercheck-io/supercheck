import Redis from "ioredis";
import { queueLogger } from "./queue";
import { checkCapacityLimits } from "./middleware/plan-enforcement";

// Redis key for job-to-organization mapping
// Used to track organizationId for each job to prevent counter drift
const JOB_ORG_MAPPING_KEY = 'capacity:job_org_mapping';
const JOB_ORG_MAPPING_TTL = 86400 * 2; // 48 hours (longer than max job retention)

/**
 * Redis-based atomic capacity manager to prevent race conditions
 * in job queue capacity enforcement
 */
export class CapacityManager {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Atomically check capacity and reserve a slot for a new job
   * Uses Redis Lua script to ensure atomicity
   * 
   * @param organizationId - Organization ID for plan-specific limits
   * @returns Promise resolving to: 0 = at capacity (rejected), 1 = can run immediately, 2 = must wait in queue
   */
  async reserveSlot(organizationId?: string): Promise<number> {
    try {
      // Get capacity limits for the organization
      const limits = await checkCapacityLimits(organizationId || 'global');
      
      // Generate unique keys for this organization
      const runningKey = organizationId 
        ? `capacity:running:${organizationId}`
        : `capacity:running:global`;
      const queuedKey = organizationId 
        ? `capacity:queued:${organizationId}`
        : `capacity:queued:global`;

      // Lua script for atomic capacity check and increment
      // Returns: 1 = can run immediately, 2 = must wait in queue, 0 = at capacity
      // IMPORTANT: When job can run immediately, we increment RUNNING counter here
      // to prevent race conditions where multiple jobs all see running < capacity
      const luaScript = `
        local runningKey = KEYS[1]
        local queuedKey = KEYS[2]
        local runningCapacity = tonumber(ARGV[1])
        local queuedCapacity = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])
        
        -- Get current counts
        local running = tonumber(redis.call('GET', runningKey) or '0')
        local queued = tonumber(redis.call('GET', queuedKey) or '0')
        
        -- Check if we can add this job to queue
        if queued >= queuedCapacity then
          -- Queue is full (at capacity)
          return 0  -- Cannot add to queue
        end
        
        -- Check if job can run immediately
        if running < runningCapacity then
          -- Job can run immediately - increment running counter NOW
          -- This prevents race conditions where multiple jobs all see running < capacity
          redis.call('INCR', runningKey)
          redis.call('EXPIRE', runningKey, ttl)
          return 1  -- Can run immediately
        else
          -- Running capacity full - job must wait in queue
          redis.call('INCR', queuedKey)
          redis.call('EXPIRE', queuedKey, ttl)
          return 2  -- Must wait in queue
        end
      `;

      // Execute Lua script atomically
      const result = await this.redis.eval(
        luaScript,
        2, // Number of keys
        runningKey,
        queuedKey,
        limits.runningCapacity,
        limits.queuedCapacity,
        86400 // TTL: 24 hours for long-running jobs
      ) as number;

      return result;
    } catch (error) {
      queueLogger.error({ err: error, organizationId }, 
        "Failed to reserve capacity slot");
      // Fail closed - if we can't verify capacity, reject the request
      return 0;
    }
  }

  /**
   * Store job-to-organization mapping for capacity tracking
   * This allows us to release capacity even when job data is unavailable
   * @param jobId - The BullMQ job ID
   * @param organizationId - Organization ID
   */
  async trackJobOrganization(jobId: string, organizationId?: string): Promise<void> {
    try {
      const orgId = organizationId || 'global';
      // Use HSET with expiry via a separate TTL tracking approach
      // Since HSET doesn't support per-field TTL, we store timestamp with the value
      const valueWithTimestamp = JSON.stringify({
        organizationId: orgId,
        createdAt: Date.now()
      });
      await this.redis.hset(JOB_ORG_MAPPING_KEY, jobId, valueWithTimestamp);
    } catch (error) {
      queueLogger.error({ err: error, jobId, organizationId },
        "Failed to track job organization mapping");
    }
  }

  /**
   * Get organization ID for a job from our mapping
   * @param jobId - The BullMQ job ID
   * @returns Organization ID or undefined if not found
   */
  async getJobOrganization(jobId: string): Promise<string | undefined> {
    try {
      const value = await this.redis.hget(JOB_ORG_MAPPING_KEY, jobId);
      if (!value) return undefined;
      
      const parsed = JSON.parse(value) as { organizationId: string; createdAt: number };
      
      // Check if mapping is too old (cleanup stale entries)
      const age = Date.now() - parsed.createdAt;
      if (age > JOB_ORG_MAPPING_TTL * 1000) {
        await this.redis.hdel(JOB_ORG_MAPPING_KEY, jobId);
        return undefined;
      }
      
      return parsed.organizationId;
    } catch (error) {
      queueLogger.error({ err: error, jobId },
        "Failed to get job organization mapping");
      return undefined;
    }
  }

  /**
   * Remove job-to-organization mapping after job completes/fails
   * @param jobId - The BullMQ job ID
   */
  async removeJobOrganization(jobId: string): Promise<void> {
    try {
      await this.redis.hdel(JOB_ORG_MAPPING_KEY, jobId);
    } catch (error) {
      queueLogger.error({ err: error, jobId },
        "Failed to remove job organization mapping");
    }
  }

  /**
   * Clean up stale job-to-organization mappings
   * Call periodically (e.g., every hour) to prevent unbounded growth
   */
  async cleanupStaleJobMappings(): Promise<number> {
    try {
      const allMappings = await this.redis.hgetall(JOB_ORG_MAPPING_KEY);
      const now = Date.now();
      let cleanedCount = 0;

      for (const [jobId, value] of Object.entries(allMappings)) {
        try {
          const parsed = JSON.parse(value) as { organizationId: string; createdAt: number };
          const age = now - parsed.createdAt;
          
          if (age > JOB_ORG_MAPPING_TTL * 1000) {
            await this.redis.hdel(JOB_ORG_MAPPING_KEY, jobId);
            cleanedCount++;
          }
        } catch {
          // If parsing fails, remove the invalid entry
          await this.redis.hdel(JOB_ORG_MAPPING_KEY, jobId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        queueLogger.info({ cleanedCount }, "Cleaned up stale job-org mappings");
      }
      return cleanedCount;
    } catch (error) {
      queueLogger.error({ err: error }, "Failed to cleanup stale job mappings");
      return 0;
    }
  }

  /**
   * Release a running slot when job completes
   * @param organizationId - Organization ID
   * @param jobId - Optional job ID for mapping cleanup
   */
  async releaseRunningSlot(organizationId?: string, jobId?: string): Promise<void> {
    try {
      const key = organizationId 
        ? `capacity:running:${organizationId}`
        : `capacity:running:global`;
      
      const result = await this.redis.decr(key);
      
      // Clean up if counter reaches 0
      if (result <= 0) {
        await this.redis.del(key);
      }

      // Clean up job mapping if jobId provided
      if (jobId) {
        await this.removeJobOrganization(jobId);
      }
    } catch (error) {
      queueLogger.error({ err: error, organizationId }, 
        "Failed to release running slot");
    }
  }

  /**
   * Transition job from queued to running state
   * Decrements queued counter and increments running counter
   * @param organizationId - Organization ID
   */
  async transitionQueuedToRunning(organizationId?: string): Promise<void> {
    try {
      const queuedKey = organizationId 
        ? `capacity:queued:${organizationId}`
        : `capacity:queued:global`;
      const runningKey = organizationId 
        ? `capacity:running:${organizationId}`
        : `capacity:running:global`;
      
      // Use a pipeline to ensure both operations happen atomically
      const pipeline = this.redis.pipeline();
      pipeline.decr(queuedKey);
      pipeline.incr(runningKey);
      pipeline.expire(runningKey, 86400); // Refresh TTL
      
      const results = await pipeline.exec();
      
      // Clean up queued key if it reaches 0
      if (results && results[0] && typeof results[0][1] === 'number' && results[0][1] <= 0) {
        await this.redis.del(queuedKey);
      }
    } catch (error) {
      queueLogger.error({ err: error, organizationId }, 
        "Failed to transition job from queued to running");
    }
  }

  /**
   * Release a queued slot when job fails before becoming active
   * @param organizationId - Organization ID
   * @param jobId - Optional job ID for mapping cleanup
   */
  async releaseQueuedSlot(organizationId?: string, jobId?: string): Promise<void> {
    try {
      const key = organizationId 
        ? `capacity:queued:${organizationId}`
        : `capacity:queued:global`;
      
      const result = await this.redis.decr(key);
      
      // Clean up if counter reaches 0
      if (result <= 0) {
        await this.redis.del(key);
      }

      // Clean up job mapping if jobId provided
      if (jobId) {
        await this.removeJobOrganization(jobId);
      }
    } catch (error) {
      queueLogger.error({ err: error, organizationId }, 
        "Failed to release queued slot");
    }
  }

  /**
   * Get current capacity usage for an organization
   * @param organizationId - Organization ID
   */
  async getCurrentUsage(organizationId?: string): Promise<{
    running: number;
    queued: number;
    runningCapacity: number;
    queuedCapacity: number;
  }> {
    try {
      const limits = await checkCapacityLimits(organizationId || 'global');
      
      const runningKey = organizationId 
        ? `capacity:running:${organizationId}`
        : `capacity:running:global`;
      const queuedKey = organizationId 
        ? `capacity:queued:${organizationId}`
        : `capacity:queued:global`;

      const [running, queued] = await Promise.all([
        this.redis.get(runningKey).then(val => parseInt(val || '0')),
        this.redis.get(queuedKey).then(val => parseInt(val || '0'))
      ]);

      return {
        running,
        queued,
        runningCapacity: limits.runningCapacity,
        queuedCapacity: limits.queuedCapacity
      };
    } catch (error) {
      queueLogger.error({ err: error, organizationId }, 
        "Failed to get current capacity usage");
      // Return zeros on error
      const limits = await checkCapacityLimits(organizationId || 'global');
      return {
        running: 0,
        queued: 0,
        runningCapacity: limits.runningCapacity,
        queuedCapacity: limits.queuedCapacity
      };
    }
  }

  /**
   * Set the running counter to a specific value (for drift correction)
   * @param value - The value to set
   * @param organizationId - Organization ID
   */
  async setRunningCounter(value: number, organizationId?: string): Promise<void> {
    try {
      const key = organizationId 
        ? `capacity:running:${organizationId}`
        : `capacity:running:global`;
      
      if (value <= 0) {
        await this.redis.del(key);
      } else {
        await this.redis.set(key, value.toString());
        await this.redis.expire(key, 86400); // 24 hour TTL
      }
    } catch (error) {
      queueLogger.error({ err: error, organizationId, value }, 
        "Failed to set running counter");
    }
  }

  /**
   * Set the queued counter to a specific value (for drift correction)
   * @param value - The value to set
   * @param organizationId - Organization ID
   */
  async setQueuedCounter(value: number, organizationId?: string): Promise<void> {
    try {
      const key = organizationId 
        ? `capacity:queued:${organizationId}`
        : `capacity:queued:global`;
      
      if (value <= 0) {
        await this.redis.del(key);
      } else {
        await this.redis.set(key, value.toString());
        await this.redis.expire(key, 86400); // 24 hour TTL
      }
    } catch (error) {
      queueLogger.error({ err: error, organizationId, value }, 
        "Failed to set queued counter");
    }
  }

  /**
   * Reset all capacity counters (useful for debugging or recovery)
   * @param organizationId - Optional organization ID to reset only that org
   */
  async resetCounters(organizationId?: string): Promise<void> {
    try {
      const pattern = organizationId 
        ? `capacity:*:${organizationId}`
        : `capacity:*`;
      
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        queueLogger.info({ organizationId, deletedKeys: keys.length }, 
          "Reset capacity counters");
      }
    } catch (error) {
      queueLogger.error({ err: error, organizationId }, 
        "Failed to reset capacity counters");
    }
  }
}

// Singleton instance
let capacityManager: CapacityManager | null = null;

/**
 * Setup capacity management event listeners for all queues
 * This ensures counters are properly released when jobs complete/fail
 */
// Interface for queue parameters to prevent circular dependency
export interface QueueParameters {
  playwrightQueues: Record<string, import('bullmq').Queue>;
  k6Queues: Record<string, import('bullmq').Queue>;
  monitorExecution: Record<string, import('bullmq').Queue>;
  jobSchedulerQueue: import('bullmq').Queue;
  k6JobSchedulerQueue: import('bullmq').Queue;
  monitorSchedulerQueue: import('bullmq').Queue;
  emailTemplateQueue: import('bullmq').Queue;
  dataLifecycleCleanupQueue: import('bullmq').Queue;
}

// Interface for QueueEvents parameters
export interface QueueEventsParameters {
  playwrightEvents: Record<string, import('bullmq').QueueEvents>;
  k6Events: Record<string, import('bullmq').QueueEvents>;
  monitorExecutionEvents: Record<string, import('bullmq').QueueEvents>;
  jobSchedulerEvents: import('bullmq').QueueEvents;
  k6JobSchedulerEvents: import('bullmq').QueueEvents;
  monitorSchedulerEvents: import('bullmq').QueueEvents;
  emailTemplateEvents: import('bullmq').QueueEvents;
  dataLifecycleCleanupEvents: import('bullmq').QueueEvents;
}

export async function setupCapacityManagement(queues: QueueParameters, queueEvents: QueueEventsParameters): Promise<void> {
  const capacityManager = await getCapacityManager();
  
  // Setup event listeners for all execution queue events
  const executionQueueEvents = [
    queueEvents.playwrightEvents["global"],
    ...Object.values(queueEvents.k6Events),
  ].filter(Boolean);
  
  for (const queueEvent of executionQueueEvents) {
    if (!queueEvent) continue;
    
    // Helper to get organizationId from job or mapping fallback
    // Checks ALL queues since we don't know which queue the job belongs to
    async function getOrgId(jobId: string): Promise<string | undefined> {
      // Try all queues - playwright first, then all K6 regional queues
      const allQueues = [
        queues.playwrightQueues["global"],
        ...Object.values(queues.k6Queues),
      ].filter(Boolean);
      
      for (const queue of allQueues) {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            const task = job.data as { organizationId?: string };
            return task.organizationId;
          }
        } catch {
          // Job may have been removed from this queue, try next
        }
      }
      
      // Fallback: try to get from our mapping
      return await capacityManager.getJobOrganization(jobId);
    }
    
    // Job completed successfully
    queueEvent.on('completed', async ({ jobId }) => {
      try {
        const organizationId = await getOrgId(jobId);
        await capacityManager.releaseRunningSlot(organizationId, jobId);
      } catch (error) {
        queueLogger.error({ err: error, jobId }, "Failed to release capacity for completed job");
        // Still try to release with fallback to global if all else fails
        await capacityManager.releaseRunningSlot(undefined, jobId);
      }
    });
    
    // Job failed - handle both queued and running states
    queueEvent.on('failed', async ({ jobId }) => {
      // Try all queues to find the job
      const allQueues = [
        queues.playwrightQueues["global"],
        ...Object.values(queues.k6Queues),
      ].filter(Boolean);
      
      try {
        let organizationId: string | undefined;
        let wasProcessed = false;
        
        // Search all queues for the job
        for (const queue of allQueues) {
          try {
            const job = await queue.getJob(jobId);
            if (job) {
              const task = job.data as { organizationId?: string };
              organizationId = task.organizationId;
              wasProcessed = job.processedOn !== undefined;
              break; // Found the job, stop searching
            }
          } catch {
            // Job may have been removed from this queue, try next
          }
        }
        
        // Fallback to mapping if job not found
        if (!organizationId) {
          organizationId = await capacityManager.getJobOrganization(jobId);
        }
        
        if (wasProcessed) {
          // Job was processed (became active), release running slot
          await capacityManager.releaseRunningSlot(organizationId, jobId);
        } else {
          // Job failed before processing, release queued slot
          await capacityManager.releaseQueuedSlot(organizationId, jobId);
        }
      } catch (error) {
        queueLogger.error({ err: error, jobId }, "Failed to release capacity for failed job");
        // Still try to release with fallback
        await capacityManager.releaseQueuedSlot(undefined, jobId);
      }
    });
    
    // Job stalled (long-running job that might be stuck)
    queueEvent.on('stalled', async ({ jobId }) => {
      try {
        const organizationId = await getOrgId(jobId);
        queueLogger.warn({ jobId, organizationId }, 
          "Job stalled, releasing capacity slot");
        await capacityManager.releaseRunningSlot(organizationId, jobId);
      } catch (error) {
        queueLogger.error({ err: error, jobId }, "Failed to release capacity for stalled job");
        await capacityManager.releaseRunningSlot(undefined, jobId);
      }
    });
    
    // Job starts running (transition from queued to running)
    queueEvent.on('active', async ({ jobId }) => {
      try {
        // Try all queues to find the job
        const allQueues = [
          queues.playwrightQueues["global"],
          ...Object.values(queues.k6Queues),
        ].filter(Boolean);
        
        let capacityStatus: string | undefined;
        let organizationId: string | undefined;
        
        // Search all queues for the job
        for (const queue of allQueues) {
          try {
            const job = await queue.getJob(jobId);
            if (job) {
              const task = job.data as { organizationId?: string; _capacityStatus?: string };
              organizationId = task.organizationId;
              capacityStatus = task._capacityStatus;
              break; // Found the job, stop searching
            }
          } catch {
            // Job may have been removed from this queue, try next
          }
        }
        
        // Fallback for organizationId
        if (!organizationId) {
          organizationId = await capacityManager.getJobOrganization(jobId);
        }
        
        // Track the job-org mapping for this job
        await capacityManager.trackJobOrganization(jobId, organizationId);
        
        // Only transition queued->running for jobs that were actually queued
        // Jobs with _capacityStatus='immediate' already had their running counter incremented at submission
        if (capacityStatus === 'queued') {
          await capacityManager.transitionQueuedToRunning(organizationId);
        }
        // For 'immediate' jobs, running counter was already incremented in reserveSlot
      } catch (error) {
        queueLogger.error({ err: error, jobId }, "Failed to transition job to active state");
      }
    });
  }
  
  queueLogger.info({ queueCount: executionQueueEvents.length }, 
    "Capacity management event listeners setup complete");
}

// Threshold for auto-correcting drift (prevent false positives from timing issues)
const DRIFT_AUTO_CORRECT_THRESHOLD = 2;

/**
 * Periodic reconciliation to detect and fix counter drift
 * Compares Redis counters against actual BullMQ job counts
 * Auto-corrects drift when persistent (above threshold)
 * 
 * @param queues - Optional queue parameters
 * @param autoCorrect - If true, automatically correct drift when detected
 */
export async function reconcileCapacityCounters(
  queues?: QueueParameters, 
  autoCorrect: boolean = true
): Promise<void> {
  try {
    const capacityManager = await getCapacityManager();
    
    // Clean up stale job mappings first
    await capacityManager.cleanupStaleJobMappings();
    
    // If no queues provided, get them (for standalone calls)
    if (!queues) {
      const queueModule = await import("./queue");
      const queuesResult = await queueModule.getQueues();
      queues = {
        playwrightQueues: queuesResult.playwrightQueues,
        k6Queues: queuesResult.k6Queues,
        monitorExecution: queuesResult.monitorExecutionQueue,
        jobSchedulerQueue: queuesResult.jobSchedulerQueue,
        k6JobSchedulerQueue: queuesResult.k6JobSchedulerQueue,
        monitorSchedulerQueue: queuesResult.monitorSchedulerQueue,
        emailTemplateQueue: queuesResult.emailTemplateQueue,
        dataLifecycleCleanupQueue: queuesResult.dataLifecycleCleanupQueue,
      };
    }
    
    // Get all execution queues (excluding monitors which bypass capacity)
    const executionQueues = [
      queues.playwrightQueues["global"],
      ...Object.values(queues.k6Queues),
    ].filter(Boolean);
    
    // Count actual jobs in BullMQ
    let actualRunning = 0;
    let actualQueued = 0;
    
    for (const queue of executionQueues) {
      const counts = await queue.getJobCounts('active', 'waiting', 'delayed');
      actualRunning += counts.active || 0;
      actualQueued += (counts.waiting || 0) + (counts.delayed || 0);
    }
    
    // Get Redis counter values for global organization
    const redisCounts = await capacityManager.getCurrentUsage();
    
    const runningDrift = redisCounts.running - actualRunning;
    const queuedDrift = redisCounts.queued - actualQueued;
    
    // Check if there's significant drift
    if (Math.abs(runningDrift) > 0 || Math.abs(queuedDrift) > 0) {
      queueLogger.warn({
        redis: { running: redisCounts.running, queued: redisCounts.queued },
        actual: { running: actualRunning, queued: actualQueued },
        drift: { running: runningDrift, queued: queuedDrift }
      }, "Capacity counter drift detected");
      
      // Auto-correct if enabled and drift exceeds threshold
      if (autoCorrect) {
        // Only correct positive drift (counters too high) to avoid over-allocating
        // Negative drift is less problematic as it just means we're being conservative
        if (runningDrift > DRIFT_AUTO_CORRECT_THRESHOLD) {
          queueLogger.info({ runningDrift, actualRunning }, 
            "Auto-correcting running capacity counter");
          await capacityManager.setRunningCounter(actualRunning);
        }
        
        if (queuedDrift > DRIFT_AUTO_CORRECT_THRESHOLD) {
          queueLogger.info({ queuedDrift, actualQueued }, 
            "Auto-correcting queued capacity counter");
          await capacityManager.setQueuedCounter(actualQueued);
        }
      }
    }
  } catch (error) {
    queueLogger.error({ err: error }, "Failed to reconcile capacity counters");
  }
}

/**
 * Get the capacity manager instance
 */
export async function getCapacityManager(): Promise<CapacityManager> {
  if (!capacityManager) {
    // Import Redis dynamically to avoid circular dependencies
    const { getRedisConnection } = await import("./queue");
    const redis = await getRedisConnection();
    capacityManager = new CapacityManager(redis);
  }
  return capacityManager;
}
