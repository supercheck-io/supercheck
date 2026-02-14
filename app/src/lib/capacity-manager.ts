import Redis from "ioredis";
import { checkCapacityLimits } from "./middleware/plan-enforcement";

// =============================================================================
// REDIS KEY PATTERNS
// =============================================================================

/**
 * Redis key patterns for capacity management:
 * - capacity:running:{orgId} - Counter of currently running jobs
 * - capacity:queued:{orgId} - Sorted set of queued job IDs (score = timestamp)
 * - capacity:job:{jobId} - Hash storing job data for queued jobs
 * - capacity:org:{jobId} - String mapping jobId to organizationId
 * - capacity:released:{jobId} - Flag indicating slot was already released (prevents double-decrement)
 */
const KEYS = {
  running: (orgId: string) => `capacity:running:${orgId}`,
  queued: (orgId: string) => `capacity:queued:${orgId}`,
  jobData: (jobId: string) => `capacity:job:${jobId}`,
  jobOrg: (jobId: string) => `capacity:org:${jobId}`,
  released: (jobId: string) => `capacity:released:${jobId}`,
} as const;

// TTL for Redis keys (24 hours)
const KEY_TTL = 86400;
// TTL for job data (48 hours - longer than max job retention)
const JOB_DATA_TTL = 86400 * 2;
// Queue processor interval (5 seconds)
const QUEUE_PROCESSOR_INTERVAL_MS = 5000;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of capacity check
 * - 'immediate': Job can run immediately (running capacity available)
 * - 'queued': Job added to queue (running capacity full, but queue available)
 */
export type CapacityStatus = 'immediate' | 'queued';

/**
 * Data stored for queued jobs
 */
export interface QueuedJobData {
  type: 'playwright' | 'k6';
  jobId: string;
  runId: string;
  organizationId: string;
  projectId: string;
  // The actual task data to pass to BullMQ
  taskData: Record<string, unknown>;
  queuedAt: number;
}

/**
 * Capacity check result
 */
export interface CapacityCheckResult {
  status: CapacityStatus;
  position?: number; // Queue position if status is 'queued'
}

// =============================================================================
// LOGGER
// =============================================================================

// Simple logger interface to avoid circular dependency with queue.ts
let logger: {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
} = {
  debug: (data, msg) => console.debug(msg, data),
  info: (data, msg) => console.info(msg, data),
  warn: (data, msg) => console.warn(msg, data),
  error: (data, msg) => console.error(msg, data),
};

/**
 * Set the logger instance (called from queue.ts to inject queueLogger)
 */
export function setCapacityLogger(l: typeof logger): void {
  logger = l;
}

// =============================================================================
// CAPACITY MANAGER CLASS
// =============================================================================

/**
 * App-side capacity manager using Redis for atomic operations
 * 
 * Design principles:
 * - All capacity management happens on the app side
 * - Uses Redis Lua scripts for atomic operations
 * - Background processor moves queued jobs to running every 5 seconds
 * - Per-organization isolation for multi-tenant support
 */
export class CapacityManager {
  private redis: Redis;
  private processorInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  // ===========================================================================
  // MAIN API - Called when run button is clicked
  // ===========================================================================

  /**
   * Check capacity and reserve a slot for a new job
   * 
   * Atomic Lua script ensures no race conditions between concurrent requests.
   * 
   * @param organizationId - Organization ID for plan-specific limits
   * @returns 0 = queue full (reject), 1 = can run immediately, 2 = must queue
   */
  async reserveSlot(organizationId: string = 'global'): Promise<number> {
    try {
      const limits = await checkCapacityLimits(organizationId);
      const runningKey = KEYS.running(organizationId);
      const queuedKey = KEYS.queued(organizationId);

      // Atomic Lua script for capacity check
      // Returns: 0 = full, 1 = immediate, 2 = queued
      const luaScript = `
        local runningKey = KEYS[1]
        local queuedKey = KEYS[2]
        local runningCapacity = tonumber(ARGV[1])
        local queuedCapacity = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])
        
        local running = tonumber(redis.call('GET', runningKey) or '0')
        local queued = redis.call('ZCARD', queuedKey)
        
        -- Check if queue is full
        if queued >= queuedCapacity then
          return 0
        end
        
        -- Check if can run immediately
        if running < runningCapacity then
          redis.call('INCR', runningKey)
          redis.call('EXPIRE', runningKey, ttl)
          return 1
        end
        
        -- Must wait in queue
        return 2
      `;

      const result = await this.redis.eval(
        luaScript,
        2,
        runningKey,
        queuedKey,
        limits.runningCapacity,
        limits.queuedCapacity,
        KEY_TTL
      ) as number;

      return result;
    } catch (error) {
      logger.error({ err: error, organizationId }, "Failed to reserve capacity slot");
      return 0; // Fail closed
    }
  }

  /**
   * Add a job to the queued set (called when reserveSlot returns 2)
   */
  async addToQueue(organizationId: string, jobData: QueuedJobData): Promise<number> {
    try {
      const queuedKey = KEYS.queued(organizationId);
      const jobDataKey = KEYS.jobData(jobData.jobId);
      const jobOrgKey = KEYS.jobOrg(jobData.jobId);

      // Use pipeline for atomic multi-key operations
      const pipeline = this.redis.pipeline();
      
      // Add to sorted set with timestamp as score (FIFO)
      pipeline.zadd(queuedKey, jobData.queuedAt, jobData.jobId);
      pipeline.expire(queuedKey, KEY_TTL);
      
      // Store job data
      pipeline.set(jobDataKey, JSON.stringify(jobData), 'EX', JOB_DATA_TTL);
      
      // Store org mapping for cleanup
      pipeline.set(jobOrgKey, organizationId, 'EX', JOB_DATA_TTL);
      
      await pipeline.exec();

      // Return queue position
      const position = await this.redis.zrank(queuedKey, jobData.jobId);
      return (position ?? 0) + 1;
    } catch (error) {
      logger.error({ err: error, jobId: jobData.jobId }, "Failed to add job to queue");
      throw error;
    }
  }

  /**
   * Release a running slot when job completes/fails
   * Uses atomic Lua script to prevent double-release:
   * - Checks if jobId already has a 'released' flag
   * - If not, sets the flag and decrements the counter
   * - If already released, does nothing (idempotent)
   */
  async releaseRunningSlot(organizationId: string = 'global', jobId?: string): Promise<void> {
    try {
      const runningKey = KEYS.running(organizationId);
      
      // If no jobId provided, just decrement (legacy behavior for edge cases)
      if (!jobId) {
        const result = await this.redis.decr(runningKey);
        if (result <= 0) {
          await this.redis.del(runningKey);
        }
        return;
      }
      
      const releasedKey = KEYS.released(jobId);
      
      // Lua script for atomic idempotent release:
      // 1. Check if job was already released (SETNX returns 0 if key exists)
      // 2. If not released (SETNX returns 1), decrement running counter
      // 3. Return 1 if released now, 0 if already released
      const luaScript = `
        local releasedKey = KEYS[1]
        local runningKey = KEYS[2]
        local ttl = tonumber(ARGV[1])
        
        -- Try to set the released flag (returns 0 if already exists)
        local wasSet = redis.call('SETNX', releasedKey, '1')
        
        if wasSet == 1 then
          -- Flag was set, this is the first release call
          redis.call('EXPIRE', releasedKey, ttl)
          local result = redis.call('DECR', runningKey)
          if result <= 0 then
            redis.call('DEL', runningKey)
          end
          return 1
        else
          -- Already released, skip decrement
          return 0
        end
      `;
      
      const result = await this.redis.eval(
        luaScript,
        2,
        releasedKey,
        runningKey,
        KEY_TTL
      ) as number;
      
      if (result === 1) {
        logger.debug({ jobId, organizationId }, "Released running slot (first release)");
      } else {
        logger.debug({ jobId, organizationId }, "Slot already released, skipping decrement");
      }

      // Clean up job data regardless of whether we released
      await this.cleanupJobData(jobId);
    } catch (error) {
      logger.error({ err: error, organizationId, jobId }, "Failed to release running slot");
    }
  }

  /**
   * Remove a job from the queued set (for cancellation)
   * This handles jobs that are waiting to be promoted but haven't started yet.
   * Note: Queued jobs don't consume running capacity - they only consume queued capacity.
   * @returns true if job was found and removed
   */
  async removeFromQueuedSet(organizationId: string, jobId: string): Promise<boolean> {
    try {
      const queuedKey = KEYS.queued(organizationId);
      const removed = await this.redis.zrem(queuedKey, jobId);
      if (removed > 0) {
        // Clean up the job data since job is cancelled
        await this.cleanupJobData(jobId);
        logger.info({ jobId, organizationId }, "Removed job from queued set (cancelled before promotion)");
        return true;
      }
      return false;
    } catch (error) {
      logger.error({ err: error, jobId, organizationId }, "Failed to remove job from queued set");
      return false;
    }
  }

  /**
   * Get current capacity usage for an organization
   */
  async getCurrentUsage(organizationId: string = 'global'): Promise<{
    running: number;
    queued: number;
    runningCapacity: number;
    queuedCapacity: number;
  }> {
    try {
      const limits = await checkCapacityLimits(organizationId);
      const runningKey = KEYS.running(organizationId);
      const queuedKey = KEYS.queued(organizationId);

      const [running, queued] = await Promise.all([
        this.redis.get(runningKey).then(val => parseInt(val || '0')),
        this.redis.zcard(queuedKey),
      ]);

      return {
        running,
        queued,
        runningCapacity: limits.runningCapacity,
        queuedCapacity: limits.queuedCapacity,
      };
    } catch (error) {
      logger.error({ err: error, organizationId }, "Failed to get capacity usage");
      const limits = await checkCapacityLimits(organizationId);
      return { running: 0, queued: 0, ...limits };
    }
  }

  // ===========================================================================
  // QUEUE PROCESSOR - Background job that runs every 5 seconds
  // ===========================================================================

  /**
   * Start the background queue processor
   * Checks for queued jobs and moves them to running when capacity is available
   */
  startQueueProcessor(): void {
    if (this.processorInterval) {
      return; // Already running
    }

    logger.info({}, "Starting capacity queue processor");

    this.processorInterval = setInterval(async () => {
      if (this.isProcessing) {
        return; // Skip if previous iteration is still running
      }
      
      try {
        this.isProcessing = true;
        await this.processQueuedJobs();
      } catch (error) {
        logger.error({ err: error }, "Queue processor error");
      } finally {
        this.isProcessing = false;
      }
    }, QUEUE_PROCESSOR_INTERVAL_MS);

    // Ensure cleanup on process exit
    process.once('exit', () => this.stopQueueProcessor());
  }

  /**
   * Stop the background queue processor
   */
  stopQueueProcessor(): void {
    if (this.processorInterval) {
      clearInterval(this.processorInterval);
      this.processorInterval = null;
      logger.info({}, "Stopped capacity queue processor");
    }
  }

  /**
   * Process all organizations with queued jobs
   * Called every 5 seconds by the processor
   */
  async processQueuedJobs(): Promise<void> {
    try {
      // Find all organizations with queued jobs using SCAN (non-blocking)
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, batch] = await this.redis.scan(
          cursor, 'MATCH', 'capacity:queued:*', 'COUNT', 100
        );
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== '0');
      
      for (const key of keys) {
        const orgId = key.replace('capacity:queued:', '');
        await this.processOrganizationQueue(orgId);
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to process queued jobs");
    }
  }

  /**
   * Process queued jobs for a specific organization
   */
  private async processOrganizationQueue(organizationId: string): Promise<void> {
    try {
      const limits = await checkCapacityLimits(organizationId);
      const runningKey = KEYS.running(organizationId);
      const queuedKey = KEYS.queued(organizationId);

      // Get current running count
      const running = parseInt(await this.redis.get(runningKey) || '0');
      const availableSlots = limits.runningCapacity - running;

      if (availableSlots <= 0) {
        return; // No capacity available
      }

      // Get jobs to promote (oldest first)
      const jobIds = await this.redis.zrange(queuedKey, 0, availableSlots - 1);

      for (const jobId of jobIds) {
        await this.promoteJob(organizationId, jobId);
      }
    } catch (error) {
      logger.error({ err: error, organizationId }, "Failed to process organization queue");
    }
  }

  /**
   * Promote a job from queued to running state
   */
  private async promoteJob(organizationId: string, jobId: string): Promise<boolean> {
    const runningKey = KEYS.running(organizationId);
    const queuedKey = KEYS.queued(organizationId);
    const jobDataKey = KEYS.jobData(jobId);

    // Use Lua script for atomic promotion
    const luaScript = `
      local runningKey = KEYS[1]
      local queuedKey = KEYS[2]
      local jobId = ARGV[1]
      local runningCapacity = tonumber(ARGV[2])
      local ttl = tonumber(ARGV[3])
      
      local running = tonumber(redis.call('GET', runningKey) or '0')
      
      -- Double-check capacity (race condition prevention)
      if running >= runningCapacity then
        return 0
      end
      
      -- Remove from queued set
      local removed = redis.call('ZREM', queuedKey, jobId)
      if removed == 0 then
        return 0  -- Already removed
      end
      
      -- Increment running counter
      redis.call('INCR', runningKey)
      redis.call('EXPIRE', runningKey, ttl)
      
      return 1
    `;

    try {
      const limits = await checkCapacityLimits(organizationId);
      const result = await this.redis.eval(
        luaScript,
        2,
        runningKey,
        queuedKey,
        jobId,
        limits.runningCapacity,
        KEY_TTL
      ) as number;

      if (result === 1) {
        // Job promoted, now add to BullMQ
        const jobDataStr = await this.redis.get(jobDataKey);
        if (jobDataStr) {
          const jobData = JSON.parse(jobDataStr) as QueuedJobData;
          await this.addJobToBullMQ(jobData);
          logger.info({ jobId, organizationId }, "Promoted queued job to running");
        } else {
          // Job data expired or missing - release the slot we just acquired
          // This prevents capacity leak when job data TTL expires before promotion
          logger.warn({ jobId, organizationId }, "Job data missing during promotion, releasing slot");
          await this.releaseRunningSlot(organizationId, jobId);
          return false;
        }
        return true;
      }
      return false;
    } catch (error) {
      logger.error({ err: error, jobId, organizationId }, "Failed to promote job");
      return false;
    }
  }

  /**
   * Add a promoted job to BullMQ
   * This is called when a job moves from queued to running
   */
  private async addJobToBullMQ(jobData: QueuedJobData): Promise<void> {
    // Track if job was successfully added to prevent double capacity release
    // If queue.add succeeds, the job will trigger completed/failed events which release the slot
    let jobAddedToBullMQ = false;
    
    try {
      // Dynamic import to avoid circular dependency
      const queueModule = await import('./queue');
      const queues = await queueModule.getQueues();

      if (jobData.type === 'playwright') {
        const queue = queues.playwrightQueues['global'];
        await queue.add(jobData.runId, {
          ...jobData.taskData,
          _capacityStatus: 'promoted', // Mark as promoted from queue
        }, { jobId: jobData.runId });
      } else {
        const location = (jobData.taskData.location as string) || 'global';
        const queue = queues.k6Queues[location] || queues.k6Queues['global'];
        await queue.add(jobData.runId, {
          ...jobData.taskData,
          _capacityStatus: 'promoted',
        }, { jobId: jobData.runId });
      }
      
      // Mark job as added - any subsequent failures should NOT release slot
      // The job will complete/fail in BullMQ and trigger event handlers
      jobAddedToBullMQ = true;

      // Update database run status from 'queued' to 'running'
      try {
        const { db } = await import('@/utils/db');
        const { runs } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');
        await db.update(runs).set({ status: 'running' }).where(eq(runs.id, jobData.runId));
        logger.info({ runId: jobData.runId }, "Updated run status from queued to running");
      } catch (dbError) {
        logger.warn({ err: dbError, runId: jobData.runId }, "Failed to update run status in database");
        // Continue - job is already in BullMQ, DB status is secondary
      }

      // Clean up job data after adding to BullMQ
      await this.cleanupJobData(jobData.jobId);
    } catch (error) {
      logger.error({ err: error, jobId: jobData.jobId }, "Failed to add promoted job to BullMQ");
      
      // CRITICAL: Only release slot if job was NEVER added to BullMQ
      // If job was added, it will release slot via completed/failed events
      if (!jobAddedToBullMQ) {
        await this.releaseRunningSlot(jobData.organizationId, jobData.jobId);
      }
      throw error;
    }
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Clean up job data from Redis
   */
  private async cleanupJobData(jobId: string): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.del(KEYS.jobData(jobId));
      pipeline.del(KEYS.jobOrg(jobId));
      await pipeline.exec();
    } catch (error) {
      logger.error({ err: error, jobId }, "Failed to cleanup job data");
    }
  }

  /**
   * Track job-to-organization mapping (for job completion handling)
   */
  async trackJobOrganization(jobId: string, organizationId: string = 'global'): Promise<void> {
    try {
      await this.redis.set(KEYS.jobOrg(jobId), organizationId, 'EX', JOB_DATA_TTL);
    } catch (error) {
      logger.error({ err: error, jobId, organizationId }, "Failed to track job organization");
    }
  }

  /**
   * Get organization ID for a job
   */
  async getJobOrganization(jobId: string): Promise<string | undefined> {
    try {
      const orgId = await this.redis.get(KEYS.jobOrg(jobId));
      return orgId || undefined;
    } catch (error) {
      logger.error({ err: error, jobId }, "Failed to get job organization");
      return undefined;
    }
  }

  /**
   * Set running counter to specific value (for drift correction)
   */
  async setRunningCounter(value: number, organizationId: string = 'global'): Promise<void> {
    try {
      const key = KEYS.running(organizationId);
      if (value <= 0) {
        await this.redis.del(key);
      } else {
        await this.redis.set(key, value.toString(), 'EX', KEY_TTL);
      }
    } catch (error) {
      logger.error({ err: error, organizationId, value }, "Failed to set running counter");
    }
  }

  /**
   * Reset all capacity counters for an organization
   */
  async resetCounters(organizationId?: string): Promise<void> {
    try {
      const pattern = organizationId ? `capacity:*:${organizationId}` : 'capacity:*';
      
      // Use SCAN for non-blocking key discovery
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, batch] = await this.redis.scan(
          cursor, 'MATCH', pattern, 'COUNT', 100
        );
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== '0');
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info({ organizationId, deletedKeys: keys.length }, "Reset capacity counters");
      }
    } catch (error) {
      logger.error({ err: error, organizationId }, "Failed to reset counters");
    }
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let capacityManager: CapacityManager | null = null;

/**
 * Get the capacity manager singleton
 */
export async function getCapacityManager(): Promise<CapacityManager> {
  if (!capacityManager) {
    const { getRedisConnection } = await import('./queue');
    const redis = await getRedisConnection();
    capacityManager = new CapacityManager(redis);
  }
  return capacityManager;
}

/**
 * Stop the queue processor and reset the singleton.
 * Called during graceful shutdown to prevent the background processor
 * from running against closed/stale Redis connections.
 */
export function resetCapacityManager(): void {
  if (capacityManager) {
    capacityManager.stopQueueProcessor();
  }
  capacityManager = null;
}

// =============================================================================
// SIMPLIFIED QUEUE EVENT SETUP
// =============================================================================

/**
 * Interface for queue parameters (minimal, for job completion handling only)
 */
export interface QueueParameters {
  playwrightQueues: Record<string, import('bullmq').Queue>;
  k6Queues: Record<string, import('bullmq').Queue>;
}

/**
 * Interface for queue events parameters
 */
export interface QueueEventsParameters {
  playwrightEvents: Record<string, import('bullmq').QueueEvents>;
  k6Events: Record<string, import('bullmq').QueueEvents>;
}

/**
 * Setup capacity management - simplified version
 * 
 * Only handles:
 * 1. Job completion events (to release running slots)
 * 2. Starting the queue processor
 * 
 * No complex state transitions - the app handles everything.
 */
export async function setupCapacityManagement(
  queues: QueueParameters,
  queueEvents: QueueEventsParameters
): Promise<void> {
  const manager = await getCapacityManager();

  // Inject the queue logger
  try {
    const { queueLogger } = await import('./queue');
    setCapacityLogger(queueLogger);
  } catch {
    // Keep default logger
  }

  // Get all execution queue events
  const allEvents = [
    queueEvents.playwrightEvents['global'],
    ...Object.values(queueEvents.k6Events),
  ].filter(Boolean);

  // Helper to get org ID for a job
  // Returns null if org cannot be determined (reconciliation will fix any drift)
  async function getOrgId(jobId: string, queues: QueueParameters): Promise<string | null> {
    // Try to get from our mapping first (most reliable)
    const mappedOrg = await manager.getJobOrganization(jobId);
    if (mappedOrg) return mappedOrg;

    // Try to find in queues (fallback for edge cases)
    const allQueues = [
      queues.playwrightQueues['global'],
      ...Object.values(queues.k6Queues),
    ].filter(Boolean);

    for (const queue of allQueues) {
      try {
        const job = await queue.getJob(jobId);
        if (job?.data?.organizationId) {
          return job.data.organizationId as string;
        }
      } catch {
        // Job not in this queue, continue
      }
    }

    // IMPORTANT: Do NOT fall back to 'global' - this corrupts multi-tenant isolation
    // If we can't determine the org, let reconciliation fix it later
    logger.warn({ jobId }, "Could not determine organization for job - reconciliation will fix any drift");
    return null;
  }

  // Setup minimal event listeners for job completion
  for (const queueEvent of allEvents) {
    // Release running slot on completion
    queueEvent.on('completed', async ({ jobId }) => {
      try {
        const orgId = await getOrgId(jobId, queues);
        if (orgId) {
          await manager.releaseRunningSlot(orgId, jobId);
        } else {
          // Skip release - reconciliation will detect and fix the drift
          logger.warn({ jobId }, "Skipping slot release on completion - org unknown, reconciliation will fix");
        }
      } catch (error) {
        logger.error({ err: error, jobId }, "Failed to release slot on completion");
        // Do NOT fallback to 'global' - let reconciliation handle it
      }
    });

    // Release running slot on failure
    queueEvent.on('failed', async ({ jobId }) => {
      try {
        const orgId = await getOrgId(jobId, queues);
        if (orgId) {
          await manager.releaseRunningSlot(orgId, jobId);
        } else {
          logger.warn({ jobId }, "Skipping slot release on failure - org unknown, reconciliation will fix");
        }
      } catch (error) {
        logger.error({ err: error, jobId }, "Failed to release slot on failure");
        // Do NOT fallback to 'global' - let reconciliation handle it
      }
    });

    // Note: We DO NOT release slot on 'stalled' event because BullMQ moves stalled jobs
    // back to the wait queue to be retried (up to maxStalledCount).
    // If we released the slot here, the job would run again consuming capacity we just released,
    // allowing another job to start and exceeding the limit.
    // If the job reaches maxStalledCount, it will fail and trigger the 'failed' event above.

    // Track job organization when it becomes active
    queueEvent.on('active', async ({ jobId }) => {
      try {
        const orgId = await getOrgId(jobId, queues);
        if (orgId) {
          await manager.trackJobOrganization(jobId, orgId);
        }
      } catch (error) {
        logger.error({ err: error, jobId }, "Failed to track job on active");
      }
    });
  }

  // Start the background queue processor
  manager.startQueueProcessor();

  logger.info({ queueCount: allEvents.length }, "Capacity management initialized");
}

// =============================================================================
// CAPACITY RECONCILIATION
// =============================================================================

/**
 * Reconcile capacity counters with actual BullMQ state.
 * Called periodically (every 5 minutes) to detect and fix drift between
 * Redis counters and actual queue state.
 * 
 * This handles scenarios like:
 * - Worker crashes that don't release slots
 * - Network issues causing missed events
 * - Counter corruption
 */
export async function reconcileCapacityCounters(
  queues?: QueueParameters,
  autoCorrect: boolean = true
): Promise<void> {
  try {
    const manager = await getCapacityManager();

    if (!queues) {
      const queueModule = await import('./queue');
      const q = await queueModule.getQueues();
      queues = {
        playwrightQueues: q.playwrightQueues,
        k6Queues: q.k6Queues,
      };
    }

    // Get all execution queues
    const executionQueues = [
      queues.playwrightQueues['global'],
      ...Object.values(queues.k6Queues),
    ].filter(Boolean);

    // 1. Count actual jobs that have consumed running slots per organization from BullMQ
    // IMPORTANT: Include both 'active' (currently executing) AND 'waiting' (reserved slot, waiting for worker)
    // Jobs in 'waiting' state have already consumed a capacity slot via reserveSlot()
    const actualRunningByOrg: Record<string, number> = {};
    
    const allActiveJobs = await Promise.all(
      executionQueues.map(q => q.getJobs(['active', 'waiting']))
    );

    for (const jobs of allActiveJobs) {
      for (const job of jobs) {
        // organizationId is always present in job data (required field)
        const orgId = job.data?.organizationId || 'global';
        actualRunningByOrg[orgId] = (actualRunningByOrg[orgId] || 0) + 1;
      }
    }

    // 2. Get all Redis capacity counters using non-blocking SCAN (not KEYS!)
    const { getRedisConnection } = await import('./queue');
    const redis = await getRedisConnection();
    
    const redisRunningByOrg: Record<string, number> = {};
    let cursor = '0';
    
    // SCAN is non-blocking and iterates incrementally
    do {
      const [nextCursor, batch] = await redis.scan(
        cursor, 
        'MATCH', 'capacity:running:*', 
        'COUNT', 100
      );
      cursor = nextCursor;
      
      // Fetch values for this batch in parallel
      if (batch.length > 0) {
        const values = await Promise.all(
          batch.map(key => redis.get(key))
        );
        
        batch.forEach((key, i) => {
          const orgId = key.replace('capacity:running:', '');
          redisRunningByOrg[orgId] = parseInt(values[i] || '0', 10);
        });
      }
    } while (cursor !== '0');

    // 3. Compare and fix drift for all organizations
    const allOrgIds = new Set([
      ...Object.keys(actualRunningByOrg),
      ...Object.keys(redisRunningByOrg)
    ]);

    for (const orgId of allOrgIds) {
      const actual = actualRunningByOrg[orgId] || 0;
      const stored = redisRunningByOrg[orgId] || 0;
      const drift = stored - actual;

      if (drift !== 0 && autoCorrect) {
        logger.warn({ 
          organizationId: orgId,
          redis: stored, 
          actual,
          drift 
        }, "Capacity drift detected, auto-correcting");
        
        await manager.setRunningCounter(actual, orgId);
      }
    }
    
    logger.info({ 
      checkedOrgs: allOrgIds.size, 
      activeJobsTotal: Object.values(actualRunningByOrg).reduce((a, b) => a + b, 0) 
    }, "Capacity reconciliation completed");

  } catch (error) {
    logger.error({ err: error }, "Capacity reconciliation failed");
  }
}
