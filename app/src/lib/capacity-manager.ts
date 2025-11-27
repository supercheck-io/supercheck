import Redis from "ioredis";
import { queueLogger } from "./queue";
import { checkCapacityLimits } from "./middleware/plan-enforcement";

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
   * @returns Promise resolving to true if slot reserved, false if at capacity
   */
  async reserveSlot(organizationId?: string): Promise<boolean> {
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
      // Simplified logic: always increment queued, check if can run immediately
      // Returns: 1 = can run immediately, 2 = must wait in queue, 0 = at capacity
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
        
        -- Always increment queued counter
        redis.call('INCR', queuedKey)
        redis.call('EXPIRE', queuedKey, ttl)
        
        -- Check if job can run immediately
        if running < runningCapacity then
          return 1  -- Can run immediately (will transition to running)
        else
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

      return result > 0;
    } catch (error) {
      queueLogger.error({ err: error, organizationId }, 
        "Failed to reserve capacity slot");
      // Fail closed - if we can't verify capacity, reject the request
      return false;
    }
  }

  /**
   * Release a running slot when job completes
   * @param organizationId - Organization ID
   */
  async releaseRunningSlot(organizationId?: string): Promise<void> {
    try {
      const key = organizationId 
        ? `capacity:running:${organizationId}`
        : `capacity:running:global`;
      
      const result = await this.redis.decr(key);
      
      // Clean up if counter reaches 0
      if (result <= 0) {
        await this.redis.del(key);
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
   */
  async releaseQueuedSlot(organizationId?: string): Promise<void> {
    try {
      const key = organizationId 
        ? `capacity:queued:${organizationId}`
        : `capacity:queued:global`;
      
      const result = await this.redis.decr(key);
      
      // Clean up if counter reaches 0
      if (result <= 0) {
        await this.redis.del(key);
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
interface QueueParameters {
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
interface QueueEventsParameters {
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
    
    // Job completed successfully
    queueEvent.on('completed', async ({ jobId }) => {
      // Get job details to extract organizationId
      const queue = queues.playwrightQueues["global"] || Object.values(queues.k6Queues)[0];
      if (queue) {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            const task = job.data as { organizationId?: string };
            await capacityManager.releaseRunningSlot(task.organizationId);
          }
        } catch (error) {
          queueLogger.error({ err: error, jobId }, "Failed to get job details for completed event");
        }
      }
    });
    
    // Job failed - handle both queued and running states
    queueEvent.on('failed', async ({ jobId }) => {
      // Get job details to extract organizationId and check if it was processed
      const queue = queues.playwrightQueues["global"] || Object.values(queues.k6Queues)[0];
      if (queue) {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            const task = job.data as { organizationId?: string };
            // Check if job ever became active by looking at its processed state
            const wasProcessed = job.processedOn !== undefined;
            
            if (wasProcessed) {
              // Job was processed (became active), release running slot
              await capacityManager.releaseRunningSlot(task.organizationId);
            } else {
              // Job failed before processing, release queued slot
              await capacityManager.releaseQueuedSlot(task.organizationId);
            }
          }
        } catch (error) {
          queueLogger.error({ err: error, jobId }, "Failed to get job details for failed event");
        }
      }
    });
    
    // Job stalled (long-running job that might be stuck)
    queueEvent.on('stalled', async ({ jobId }) => {
      // Get job details to extract organizationId
      const queue = queues.playwrightQueues["global"] || Object.values(queues.k6Queues)[0];
      if (queue) {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            const task = job.data as { organizationId?: string };
            queueLogger.warn({ jobId, organizationId: task.organizationId }, 
              "Job stalled, releasing capacity slot");
            await capacityManager.releaseRunningSlot(task.organizationId);
          }
        } catch (error) {
          queueLogger.error({ err: error, jobId }, "Failed to get job details for stalled event");
        }
      }
    });
    
    // Job starts running (transition from queued to running)
    queueEvent.on('active', async ({ jobId }) => {
      // Get job details to extract organizationId
      const queue = queues.playwrightQueues["global"] || Object.values(queues.k6Queues)[0];
      if (queue) {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            const task = job.data as { organizationId?: string };
            // When job becomes active, transition from queued to running
            await capacityManager.transitionQueuedToRunning(task.organizationId);
          }
        } catch (error) {
          queueLogger.error({ err: error, jobId }, "Failed to get job details for active event");
        }
      }
    });
  }
  
  queueLogger.info({ queueCount: executionQueueEvents.length }, 
    "Capacity management event listeners setup complete");
}

/**
 * Periodic reconciliation to detect and fix counter drift
 * Compares Redis counters against actual BullMQ job counts
 */
export async function reconcileCapacityCounters(queues?: QueueParameters): Promise<void> {
try {
  const capacityManager = await getCapacityManager();
  
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
    
    // Get Redis counter values
    const redisCounts = await capacityManager.getCurrentUsage();
    
    // Log if there's drift (for debugging)
    if (redisCounts.running !== actualRunning || redisCounts.queued !== actualQueued) {
      queueLogger.warn({
        redis: { running: redisCounts.running, queued: redisCounts.queued },
        actual: { running: actualRunning, queued: actualQueued },
        drift: {
          running: redisCounts.running - actualRunning,
          queued: redisCounts.queued - actualQueued
        }
      }, "Capacity counter drift detected - consider manual reset if persistent");
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
