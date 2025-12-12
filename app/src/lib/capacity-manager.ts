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
 */
const KEYS = {
  running: (orgId: string) => `capacity:running:${orgId}`,
  queued: (orgId: string) => `capacity:queued:${orgId}`,
  jobData: (jobId: string) => `capacity:job:${jobId}`,
  jobOrg: (jobId: string) => `capacity:org:${jobId}`,
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
   */
  async releaseRunningSlot(organizationId: string = 'global', jobId?: string): Promise<void> {
    try {
      const runningKey = KEYS.running(organizationId);
      
      const result = await this.redis.decr(runningKey);
      if (result <= 0) {
        await this.redis.del(runningKey);
      }

      // Clean up job data if provided
      if (jobId) {
        await this.cleanupJobData(jobId);
      }
    } catch (error) {
      logger.error({ err: error, organizationId, jobId }, "Failed to release running slot");
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

      // Update database run status from 'queued' to 'running'
      try {
        const { db } = await import('@/utils/db');
        const { runs } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');
        await db.update(runs).set({ status: 'running' }).where(eq(runs.id, jobData.runId));
        logger.info({ runId: jobData.runId }, "Updated run status from queued to running");
      } catch (dbError) {
        logger.warn({ err: dbError, runId: jobData.runId }, "Failed to update run status in database");
        // Continue - job is already in BullMQ
      }

      // Clean up job data after adding to BullMQ
      await this.cleanupJobData(jobData.jobId);
    } catch (error) {
      logger.error({ err: error, jobId: jobData.jobId }, "Failed to add promoted job to BullMQ");
      // Release the slot since we couldn't add it
      await this.releaseRunningSlot(jobData.organizationId, jobData.jobId);
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
  async function getOrgId(jobId: string, queues: QueueParameters): Promise<string> {
    // Try to get from our mapping first
    const mappedOrg = await manager.getJobOrganization(jobId);
    if (mappedOrg) return mappedOrg;

    // Try to find in queues
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
        // Job not in this queue
      }
    }

    return 'global';
  }

  // Setup minimal event listeners for job completion
  for (const queueEvent of allEvents) {
    // Release running slot on completion
    queueEvent.on('completed', async ({ jobId }) => {
      try {
        const orgId = await getOrgId(jobId, queues);
        await manager.releaseRunningSlot(orgId, jobId);
      } catch (error) {
        logger.error({ err: error, jobId }, "Failed to release slot on completion");
        await manager.releaseRunningSlot('global', jobId);
      }
    });

    // Release running slot on failure
    queueEvent.on('failed', async ({ jobId }) => {
      try {
        const orgId = await getOrgId(jobId, queues);
        await manager.releaseRunningSlot(orgId, jobId);
      } catch (error) {
        logger.error({ err: error, jobId }, "Failed to release slot on failure");
        await manager.releaseRunningSlot('global', jobId);
      }
    });

    // Release running slot on stalled (job timeout)
    queueEvent.on('stalled', async ({ jobId }) => {
      try {
        const orgId = await getOrgId(jobId, queues);
        logger.warn({ jobId, orgId }, "Job stalled, releasing capacity");
        await manager.releaseRunningSlot(orgId, jobId);
      } catch (error) {
        logger.error({ err: error, jobId }, "Failed to release slot on stall");
        await manager.releaseRunningSlot('global', jobId);
      }
    });

    // Track job organization when it becomes active
    queueEvent.on('active', async ({ jobId }) => {
      try {
        const orgId = await getOrgId(jobId, queues);
        await manager.trackJobOrganization(jobId, orgId);
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

    // 1. Count actual active jobs per organization from BullMQ
    const actualRunningByOrg: Record<string, number> = {};
    
    const allActiveJobs = await Promise.all(
      executionQueues.map(q => q.getJobs(['active']))
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
