import crypto from "crypto";
import { Queue, QueueEvents } from "bullmq";
import Redis, { RedisOptions } from "ioredis";
import type {
  LocationConfig,
  MonitorConfig,
  MonitoringLocation,
} from "@/db/schema";
import type { JobType as SchemaJobType } from "@/db/schema";
import {
  getEffectiveLocations,
  isMonitoringLocation,
} from "./location-service";
import { createLogger } from "./logger/index";

// Create queue logger
export const queueLogger = createLogger({ module: 'queue-client' }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

// Interfaces matching those in the worker service
export interface TestExecutionTask {
  testId: string;
  code: string; // Pass code directly
  variables?: Record<string, string>; // Resolved variables for the test
  secrets?: Record<string, string>; // Resolved secrets for the test
  runId?: string | null;
  organizationId?: string;
  projectId?: string;
  location?: string | null;
  metadata?: Record<string, unknown>;
}

export interface JobExecutionTask {
  jobId: string;
  testScripts: Array<{
    id: string;
    script: string;
    name?: string;
  }>;
  runId: string; // Optional run ID to distinguish parallel executions of the same job
  originalJobId?: string; // The original job ID from the 'jobs' table
  trigger?: "manual" | "remote" | "schedule"; // Trigger type for the job execution
  organizationId: string; // Required for RBAC filtering
  projectId: string; // Required for RBAC filtering
  variables?: Record<string, string>; // Resolved variables for job execution
  secrets?: Record<string, string>; // Resolved secrets for job execution
  jobType?: SchemaJobType;
  location?: string | null;
}

// Interface for Monitor Job Data (mirroring DTO in runner)
export interface MonitorJobData {
  monitorId: string;
  type: "http_request" | "website" | "ping_host" | "port_check";
  target: string;
  config?: unknown; // Using unknown for config for now, can be refined with shared MonitorConfig type
  frequencyMinutes?: number;
  executionLocation?: MonitoringLocation;
  executionGroupId?: string;
  expectedLocations?: MonitoringLocation[];
}

export interface K6ExecutionTask {
  runId: string;
  testId: string;
  organizationId: string;
  projectId: string;
  script: string;
  jobId?: string | null;
  tests: Array<{ id: string; script: string }>;
  location?: string | null;
  jobType?: string;
}

// Constants for queue names and Redis keys
export const MONITOR_EXECUTION_QUEUE = "monitor-execution";

// Scheduler-related queues
export const JOB_SCHEDULER_QUEUE = "job-scheduler";
export const K6_JOB_SCHEDULER_QUEUE = "k6-job-scheduler";
export const MONITOR_SCHEDULER_QUEUE = "monitor-scheduler";

// Email template rendering queue
export const EMAIL_TEMPLATE_QUEUE = "email-template-render";

// Data lifecycle cleanup queue
export const DATA_LIFECYCLE_CLEANUP_QUEUE = "data-lifecycle-cleanup";

// Redis capacity limit keys
export const RUNNING_CAPACITY_LIMIT_KEY = "supercheck:capacity:running";
export const QUEUE_CAPACITY_LIMIT_KEY = "supercheck:capacity:queued";

// Redis key TTL values (in seconds) - applies to both job and test execution
export const REDIS_JOB_KEY_TTL = 7 * 24 * 60 * 60; // 7 days for job data (completed/failed jobs)
export const REDIS_EVENT_KEY_TTL = 24 * 60 * 60; // 24 hours for events/stats
export const REDIS_METRICS_TTL = 48 * 60 * 60; // 48 hours for metrics data
export const REDIS_CLEANUP_BATCH_SIZE = 100; // Process keys in smaller batches to reduce memory pressure

// Regions for K6 performance tests (includes global option for any location)
export type Region = "us-east" | "eu-central" | "asia-pacific" | "global";
export const REGIONS: Region[] = ["us-east", "eu-central", "asia-pacific", "global"];

// Monitor regions using kebab-case for queue names (no GLOBAL - monitors run from specific locations)
export type MonitorRegion = "us-east" | "eu-central" | "asia-pacific";
export const MONITOR_REGIONS: MonitorRegion[] = ["us-east", "eu-central", "asia-pacific"];

// Singleton instances
let redisClient: Redis | null = null;

// Region-specific queues
const playwrightQueues: Record<string, Queue> = {};
const k6Queues: Record<string, Queue> = {};

let monitorExecution: Record<MonitorRegion, Queue> | null = null;
let jobSchedulerQueue: Queue | null = null;
let k6JobSchedulerQueue: Queue | null = null;
let monitorSchedulerQueue: Queue | null = null;
let emailTemplateQueue: Queue | null = null;
let dataLifecycleCleanupQueue: Queue | null = null;

let monitorExecutionEvents: Record<MonitorRegion, QueueEvents> | null = null;

// Store initialization promise to prevent race conditions
let initPromise: Promise<void> | null = null;

// Queue event subscription type
export type QueueEventType = "test" | "job";

export function buildRedisOptions(
  overrides: Partial<RedisOptions> = {},
): RedisOptions {
  const host = process.env.REDIS_HOST || "localhost";
  const port = parseInt(process.env.REDIS_PORT || "6379");
  const password = process.env.REDIS_PASSWORD;

  return {
    host,
    port,
    password: password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 100, 3000);
      queueLogger.warn(
        { times, delay },
        `Redis connection retry ${times}, delaying ${delay}ms`
      );
      return delay;
    },
    ...overrides,
  };
}

/**
 * Get or create Redis connection using environment variables.
 */
export async function getRedisConnection(): Promise<Redis> {
  if (redisClient && redisClient.status === "ready") {
    return redisClient;
  }

  if (redisClient) {
    try {
      await redisClient.quit();
    } catch (e) {
      queueLogger.error({ err: e }, "Error quitting old Redis client");
    }
    redisClient = null;
  }

  const connectionOpts = buildRedisOptions();

  redisClient = new Redis(connectionOpts);

  redisClient.on("error", (err) =>
    queueLogger.error({ err: err }, "[Queue Client] Redis Error:")
  );
  redisClient.on("connect", () => {});
  redisClient.on("ready", async () => {
    // Redis connection is ready
  });
  redisClient.on("close", () => {});

  // Wait briefly for connection, but don't block indefinitely if Redis is down
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Redis connection timeout")),
        5000
      );
      redisClient?.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
      redisClient?.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  } catch (err) {
    queueLogger.error({ err: err }, "[Queue Client] Failed initial Redis connection:");
    // Allow proceeding, BullMQ might handle reconnection attempts
  }

  return redisClient;
}

/**
 * Get queue instances, initializing them if necessary.
 */
export async function getQueues(): Promise<{
  playwrightQueues: Record<string, Queue>;
  k6Queues: Record<string, Queue>;
  monitorExecutionQueue: Record<MonitorRegion, Queue>;
  jobSchedulerQueue: Queue;
  k6JobSchedulerQueue: Queue;
  monitorSchedulerQueue: Queue;
  emailTemplateQueue: Queue;
  dataLifecycleCleanupQueue: Queue;
  redisConnection: Redis;
}> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const connection = await getRedisConnection();

        // Memory-optimized job options with retry for transient failures
        // Retries help with container startup issues, network problems, etc.
        // Usage is only tracked on successful completion, so retries don't cause duplicate billing
        const defaultJobOptions = {
          removeOnComplete: { count: 500, age: 24 * 3600 }, // Keep completed jobs for 24 hours (500 max)
          removeOnFail: { count: 1000, age: 7 * 24 * 3600 }, // Keep failed jobs for 7 days (1000 max)
          attempts: 3, // Retry up to 3 times for transient failures
          backoff: {
            type: 'exponential',
            delay: 5000, // Start with 5 second delay, then 10s, 20s
          },
        };

        // Queue settings with Redis TTL and auto-cleanup options
        // CRITICAL: lockDuration and stallInterval must accommodate max execution times:
        // - Tests: up to 5 minutes (300s)
        // - Jobs: up to 1 hour (3600s)
        // - lockDuration: 70 minutes (4200s) - max execution time + buffer for cleanup
        // - stallInterval: 30 seconds - check frequently for stalled jobs
        const queueSettings = {
          connection,
          defaultJobOptions,
          // Settings to prevent orphaned Redis keys and handle long-running jobs
          lockDuration: 70 * 60 * 1000, // 70 minutes - must be >= max execution time (60 min for jobs)
          stallInterval: 30000, // Check for stalled jobs every 30 seconds
          maxStalledCount: 2, // Move job back to waiting max 2 times before failing
          metrics: {
            maxDataPoints: 60, // Limit metrics storage to 60 data points (1 hour at 1 min interval)
            collectDurations: true,
          },
        };

        // Playwright - single GLOBAL queue for all tests and jobs
        const playwrightQueue = new Queue("playwright-global", queueSettings);
        playwrightQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "Playwright Queue Error")
        );
        playwrightQueues["global"] = playwrightQueue;

        // K6 - Regional queues (keep existing)
        for (const region of REGIONS) {
          const k6QueueName = `k6-${region}`;
          const k6Queue = new Queue(k6QueueName, queueSettings);
          k6Queue.on("error", (error) =>
            queueLogger.error({ err: error }, `k6 Queue (${region}) Error`)
          );
          k6Queues[region] = k6Queue;
        }

        // Monitor Execution - Regional queues using kebab-case (no GLOBAL)
        const monitorQueues: Record<MonitorRegion, Queue> = {} as Record<MonitorRegion, Queue>;
        for (const region of MONITOR_REGIONS) {
          const monitorQueueName = `monitor-${region}`;
          const monitorQueue = new Queue(monitorQueueName, queueSettings);
          monitorQueue.on("error", (error) =>
            queueLogger.error({ err: error }, `Monitor Queue (${region}) Error`)
          );
          monitorQueues[region] = monitorQueue;
        }

        monitorExecution = monitorQueues; // Store all monitor queues

        // Schedulers
        jobSchedulerQueue = new Queue(JOB_SCHEDULER_QUEUE, queueSettings);
        k6JobSchedulerQueue = new Queue(
          K6_JOB_SCHEDULER_QUEUE,
          queueSettings
        );
        monitorSchedulerQueue = new Queue(
          MONITOR_SCHEDULER_QUEUE,
          queueSettings
        );

        // Email template rendering queue
        emailTemplateQueue = new Queue(EMAIL_TEMPLATE_QUEUE, queueSettings);

        // Data lifecycle cleanup queue
        dataLifecycleCleanupQueue = new Queue(DATA_LIFECYCLE_CLEANUP_QUEUE, queueSettings);

        // Monitor Execution Events - Regional (no GLOBAL)
        const monitorEvents: Record<MonitorRegion, QueueEvents> = {} as Record<MonitorRegion, QueueEvents>;
        for (const region of MONITOR_REGIONS) {
          const eventsConnection = redisClient!.duplicate();
          // ioredis connects automatically by default, so we don't need to call connect()
          // unless lazyConnect: true is set in options (which it isn't)
          monitorEvents[region] = new QueueEvents(`monitor-${region}`, {
            connection: eventsConnection,
          });
        }
        monitorExecutionEvents = monitorEvents;

        // Create QueueEvents for execution queues
        const playwrightEvents: Record<string, QueueEvents> = {};
        playwrightEvents["global"] = new QueueEvents("playwright-global", {
          connection: redisClient!.duplicate(),
        });

        const k6Events: Record<string, QueueEvents> = {};
        for (const region of REGIONS) {
          k6Events[region] = new QueueEvents(`k6-${region}`, {
            connection: redisClient!.duplicate(),
          });
        }

        // Add error listeners for regional monitor queues
        for (const region of MONITOR_REGIONS) {
          monitorExecution[region].on("error", (error: Error) =>
            queueLogger.error({ err: error, region }, `Monitor Queue (${region}) Error`)
          );
          monitorExecutionEvents[region].on("error", (error: Error) =>
            queueLogger.error({ err: error, region }, `Monitor Events (${region}) Error`)
          );
        }

        jobSchedulerQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "Job Scheduler Queue Error")
        );
        k6JobSchedulerQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "k6 Job Scheduler Queue Error")
        );
        monitorSchedulerQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "Monitor Scheduler Queue Error")
        );
        emailTemplateQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "Email Template Queue Error")
        );
        dataLifecycleCleanupQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "Data Lifecycle Cleanup Queue Error")
        );

        // Set up periodic cleanup for orphaned Redis keys
        await setupQueueCleanup(connection);

        // Set up capacity management with atomic counters (pass queues to prevent circular dependency)
        const { setupCapacityManagement } = await import("./capacity-manager");
        
        // Create QueueEvents for remaining queues
        const jobSchedulerEvents = new QueueEvents(JOB_SCHEDULER_QUEUE, {
          connection: redisClient!.duplicate(),
        });
        const k6JobSchedulerEvents = new QueueEvents(K6_JOB_SCHEDULER_QUEUE, {
          connection: redisClient!.duplicate(),
        });
        const monitorSchedulerEvents = new QueueEvents(MONITOR_SCHEDULER_QUEUE, {
          connection: redisClient!.duplicate(),
        });
        const emailTemplateEvents = new QueueEvents(EMAIL_TEMPLATE_QUEUE, {
          connection: redisClient!.duplicate(),
        });
        const dataLifecycleCleanupEvents = new QueueEvents(DATA_LIFECYCLE_CLEANUP_QUEUE, {
          connection: redisClient!.duplicate(),
        });

        await setupCapacityManagement({
          playwrightQueues,
          k6Queues,
          monitorExecution,
          jobSchedulerQueue,
          k6JobSchedulerQueue,
          monitorSchedulerQueue,
          emailTemplateQueue,
          dataLifecycleCleanupQueue,
        }, {
          playwrightEvents,
          k6Events,
          monitorExecutionEvents,
          jobSchedulerEvents,
          k6JobSchedulerEvents,
          monitorSchedulerEvents,
          emailTemplateEvents,
          dataLifecycleCleanupEvents,
        });

        // BullMQ Queues initialized
      } catch (error) {
        queueLogger.error({ err: error }, "[Queue Client] Failed to initialize queues:");
        // Reset promise to allow retrying later
        initPromise = null;
        throw error; // Re-throw to indicate failure
      }
    })();
  }
  await initPromise;

  if (
    Object.keys(playwrightQueues).length !== 1 || // Single GLOBAL queue
    Object.keys(k6Queues).length !== REGIONS.length || // Regional queues  
    !monitorExecution ||
    Object.keys(monitorExecution).length !== MONITOR_REGIONS.length || // Regional monitor queues (US, EU, APAC)
    !monitorExecutionEvents ||
    Object.keys(monitorExecutionEvents).length !== MONITOR_REGIONS.length || // Regional monitor events
    !jobSchedulerQueue ||
    !k6JobSchedulerQueue ||
    !monitorSchedulerQueue ||
    !emailTemplateQueue ||
    !dataLifecycleCleanupQueue ||
    !redisClient
  ) {
    throw new Error(
      "One or more queues or event listeners could not be initialized."
    );
  }
  return {
    playwrightQueues,
    k6Queues,
    monitorExecutionQueue: monitorExecution,
    jobSchedulerQueue,
    k6JobSchedulerQueue,
    monitorSchedulerQueue,
    emailTemplateQueue,
    dataLifecycleCleanupQueue,
    redisConnection: redisClient,
  };
}

/**
 * Sets up periodic cleanup of orphaned Redis keys to prevent unbounded growth
 */
// Track if cleanup has been set up to prevent duplicate event listeners
let cleanupSetupComplete = false;

async function setupQueueCleanup(connection: Redis): Promise<void> {
  // Only set up cleanup once to prevent multiple process event listeners
  if (cleanupSetupComplete) {
    return;
  }

  cleanupSetupComplete = true;

  try {
    // Run initial cleanup on startup to clear any existing orphaned keys
    await performQueueCleanup(connection);

    // Schedule queue cleanup every 12 hours (43200000 ms) - more frequent than before
    const cleanupInterval = setInterval(async () => {
      try {
        await performQueueCleanup(connection);
      } catch (error) {
        queueLogger.error(
          { err: error },
          "Error during scheduled queue cleanup"
        );
      }
    }, 12 * 60 * 60 * 1000); // Run cleanup every 12 hours

    // Make sure interval is properly cleared on process exit
    // Use process.once to prevent duplicate listeners
    process.once("exit", () => clearInterval(cleanupInterval));
  } catch (error) {
    queueLogger.error({ err: error }, "[Queue Client] Failed to set up queue cleanup:");
  }
}

/**
 * Performs the actual queue cleanup operations
 * Extracted to a separate function for reuse in initial and scheduled cleanup
 */
async function performQueueCleanup(connection: Redis): Promise<void> {
  // Running queue cleanup
  const queuesToClean = [
    { name: JOB_SCHEDULER_QUEUE, queue: jobSchedulerQueue },
    { name: K6_JOB_SCHEDULER_QUEUE, queue: k6JobSchedulerQueue },
    { name: MONITOR_SCHEDULER_QUEUE, queue: monitorSchedulerQueue },
    { name: EMAIL_TEMPLATE_QUEUE, queue: emailTemplateQueue },
    ...Object.entries(playwrightQueues).map(([region, queue]) => ({
      name: `playwright-${region}`,
      queue,
    })),
    ...Object.entries(k6Queues).map(([region, queue]) => ({
      name: `k6-${region}`,
      queue,
    })),
    // Add regional monitor queues
    ...Object.entries(monitorExecution || {}).map(([region, queue]) => ({
      name: `monitor-${region}`,
      queue,
    })),
  ];

  for (const { name, queue } of queuesToClean) {
    if (queue) {
      // Cleaning up queue
      await cleanupOrphanedKeys(connection, name); // Cleans up BullMQ internal keys

      // Clean completed and failed jobs older than REDIS_JOB_KEY_TTL from the queue itself
      await queue.clean(
        REDIS_JOB_KEY_TTL * 1000,
        REDIS_CLEANUP_BATCH_SIZE,
        "completed"
      );
      await queue.clean(
        REDIS_JOB_KEY_TTL * 1000,
        REDIS_CLEANUP_BATCH_SIZE,
        "failed"
      );

      // Trim events to prevent Redis memory issues
      await queue.trimEvents(1000); // Keep last 1000 events
      // Finished cleaning queue
    }
  }
  // Finished queue cleanup
}

/**
 * Cleans up orphaned keys for a specific queue in batches to reduce memory pressure
 */
async function cleanupOrphanedKeys(
  connection: Redis,
  queueName: string
): Promise<void> {
  try {
    // Get keys in batches using scan instead of keys command
    let cursor = "0";
    do {
      const [nextCursor, keys] = await connection.scan(
        cursor,
        "MATCH",
        `bull:${queueName}:*`,
        "COUNT",
        "100"
      );

      cursor = nextCursor;

      // Process this batch of keys
      for (const key of keys) {
        // Skip keys that BullMQ manages properly (active jobs, waiting jobs, etc.)
        if (
          key.includes(":active") ||
          key.includes(":wait") ||
          key.includes(":delayed") ||
          key.includes(":failed") ||
          key.includes(":completed") ||
          key.includes(":schedulers")
        ) {
          // Preserve job scheduler keys
          continue;
        }

        // Check if the key has a TTL set
        const ttl = await connection.ttl(key);
        if (ttl === -1) {
          // -1 means no TTL is set
          // Set appropriate TTL based on key type
          let expiryTime = REDIS_JOB_KEY_TTL;

          if (key.includes(":events:")) {
            expiryTime = REDIS_EVENT_KEY_TTL;
          } else if (key.includes(":metrics")) {
            expiryTime = REDIS_METRICS_TTL;
          } else if (key.includes(":meta") || key.includes(":scheduler:")) {
            continue; // Skip meta keys and scheduler keys as they should live as long as the app runs
          }

          await connection.expire(key, expiryTime);
          // Set TTL for key
        }
      }
    } while (cursor !== "0");
  } catch (error) {
    queueLogger.error(
      { err: error, queueName },
      `Error cleaning up orphaned keys for ${queueName}`
    );
  }
}

/**
 * Helper to get the correct queue based on type and location
 */
function getQueue(
  queues: {
    playwrightQueues: Record<string, Queue>;
    k6Queues: Record<string, Queue>;
  },
  type: "playwright" | "k6",
  location?: string | null
): Queue {
  if (type === "playwright") {
    // Playwright always uses global queue
    const queue = queues.playwrightQueues["global"];
    if (!queue) {
      throw new Error("Playwright execution queue is not available");
    }
    return queue;
  } else {
    // K6 uses regional queues with kebab-case names
    const regionStr = (location || "global").toLowerCase();

    const effectiveRegion = REGIONS.includes(regionStr as Region)
      ? regionStr
      : "global";

    const queue = queues.k6Queues[effectiveRegion];
    if (!queue) {
      throw new Error("K6 execution queue is not available for the requested region");
    }
    return queue;
  }
}

/**
 * Add a test execution task to the queue.
 * Test executions participate in the shared parallel execution capacity.
 */
export async function addTestToQueue(task: TestExecutionTask): Promise<string> {
  const queues = await getQueues();
  const queue = getQueue(queues, "playwright", task.location);
  const jobUuid = task.runId ?? task.testId; // Prefer runId for unique tracking
  // Adding test to queue

  try {
    // Enforce parallel execution limits before enqueueing (with org-specific limits)
    await verifyQueueCapacityOrThrow(task.organizationId);

    const jobOptions = {
      jobId: jobUuid,
      // Timeout option would be: timeout: timeoutMs
      // But timeout/duration is managed by worker instead
    };
    // Use runId as job name for direct matching
    await queue.add(jobUuid, task, jobOptions);
    // Test added successfully
    return jobUuid;
  } catch (error) {
    queueLogger.error({ err: error, jobUuid },
      `Error adding test ${jobUuid} to queue`);
    throw new Error(
      `Failed to add test execution job: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Add a job execution task (multiple tests) to the queue.
 */
export async function addJobToQueue(task: JobExecutionTask): Promise<string> {
  const queues = await getQueues();
  const queue = getQueue(queues, "playwright", task.location);
  const runId = task.runId; // Use runId for consistency with scheduled jobs
  // Adding job to queue

  try {
    // Check the current queue size against QUEUED_CAPACITY (with org-specific limits)
    await verifyQueueCapacityOrThrow(task.organizationId);

    // Setting timeout

    // Use runId as job name for direct matching
    // Note: Uses queue's defaultJobOptions for attempts/backoff
    await queue.add(runId, task, {
      jobId: runId, // Use runId as BullMQ job ID for consistency
    });
    // Job added successfully
    return runId;
  } catch (error) {
    queueLogger.error({ err: error }, `[Queue Client] Error adding job ${runId} to queue:`);
    throw new Error(
      `Failed to add job execution job: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Add a k6 performance test execution task to the dedicated queue.
 */
export async function addK6TestToQueue(
  task: K6ExecutionTask,
  jobName = "k6-test-execution"
): Promise<string> {
  const queues = await getQueues();
  const queue = getQueue(queues, "k6", task.location);

  try {
    // Enforce parallel execution limits (with org-specific limits)
    await verifyQueueCapacityOrThrow(task.organizationId);

    // Note: Uses queue's defaultJobOptions for attempts/backoff
    await queue.add(jobName, task, {
      jobId: task.runId,
    });
    return task.runId;
  } catch (error) {
    queueLogger.error({ err: error, runId: task.runId },
      `Error adding k6 test ${task.runId} to queue`);
    throw new Error(
      `Failed to add k6 test execution job: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Add a k6 performance job execution task to the dedicated queue.
 */
export async function addK6JobToQueue(
  task: K6ExecutionTask,
  jobName = "k6-job-execution"
): Promise<string> {
  const queues = await getQueues();
  const queue = getQueue(queues, "k6", task.location);

  try {
    // Enforce parallel execution limits (with org-specific limits)
    await verifyQueueCapacityOrThrow(task.organizationId);

    // Note: Uses queue's defaultJobOptions for attempts/backoff
    await queue.add(jobName, task, {
      jobId: task.runId,
    });
    return task.runId;
  } catch (error) {
    queueLogger.error({ err: error, runId: task.runId },
      `Error adding k6 job ${task.runId} to queue`);
    throw new Error(
      `Failed to add k6 job execution: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Atomically verify capacity and reserve a slot before adding a new job
 * Uses Redis-based atomic counters to prevent race conditions
 * 
 * @param organizationId - Organization ID to check plan-specific capacity limits
 * @throws Error if the queue capacity is exceeded
 * @returns Promise resolving to true if slot reserved, throws if at capacity
 */
export async function verifyQueueCapacityOrThrow(organizationId?: string): Promise<void> {
  // Import the capacity manager
  const { getCapacityManager } = await import("./capacity-manager");
  
  try {
    const capacityManager = await getCapacityManager();
    const slotReserved = await capacityManager.reserveSlot(organizationId);
    
    if (!slotReserved) {
      // Get capacity details for error message
      const limits = await capacityManager.getCurrentUsage(organizationId);
      throw new Error(
        `Queue capacity limit reached (${limits.queued}/${limits.queuedCapacity} queued jobs). Please try again later when running capacity (${limits.running}/${limits.runningCapacity}) is available.`
      );
    }
    
    // Slot successfully reserved - job can proceed
    return;
  } catch (error) {
    // Rethrow capacity errors
    if (error instanceof Error && error.message.includes("capacity limit")) {
      queueLogger.error({ err: error, organizationId }, "Capacity limit error");
      throw error;
    }

    // For other errors, log but still enforce a basic check
    queueLogger.error({ err: error, organizationId },
      "Error checking queue capacity");

    // Fail closed on errors - be conservative when we can't verify capacity
    throw new Error(
      `Unable to verify queue capacity due to an error. Please try again later.`
    );
  }
}

/**
 * Close queue connections (useful for graceful shutdown).
 */
export async function closeQueue(): Promise<void> {
  const promises = [];
  for (const queue of Object.values(playwrightQueues)) {
    promises.push(queue.close());
  }
  for (const queue of Object.values(k6Queues)) {
    promises.push(queue.close());
  }
  // Close all regional monitor queues
  if (monitorExecution) {
    for (const queue of Object.values(monitorExecution)) {
      promises.push(queue.close());
    }
  }
  if (jobSchedulerQueue) promises.push(jobSchedulerQueue.close());
  if (k6JobSchedulerQueue) promises.push(k6JobSchedulerQueue.close());
  if (monitorSchedulerQueue) promises.push(monitorSchedulerQueue.close());
  if (emailTemplateQueue) promises.push(emailTemplateQueue.close());
  if (redisClient) promises.push(redisClient.quit());

  // Close all regional monitor events
  if (monitorExecutionEvents) {
    for (const events of Object.values(monitorExecutionEvents)) {
      promises.push(events.close());
    }
  }

  try {
    await Promise.all(promises);
    // All queues closed
  } catch (error) {
    queueLogger.error({ err: error }, "[Queue Client] Error closing queues and events:");
  } finally {
    // Reset queues
    for (const key in playwrightQueues) delete playwrightQueues[key];
    for (const key in k6Queues) delete k6Queues[key];
    monitorExecution = null;
    jobSchedulerQueue = null;
    k6JobSchedulerQueue = null;
    monitorSchedulerQueue = null;
    emailTemplateQueue = null;
    redisClient = null;
    initPromise = null;
    monitorExecutionEvents = null;
  }
}

/**
 * Set capacity limit for running tests through Redis
 */
export async function setRunCapacityLimit(limit: number): Promise<void> {
  const sharedRedis = await getRedisConnection();
  const redis = sharedRedis.duplicate();

  try {
    await redis.set(RUNNING_CAPACITY_LIMIT_KEY, String(limit));
  } finally {
    await redis.quit();
  }
}

/**
 * Set capacity limit for queued tests through Redis
 */
export async function setQueueCapacityLimit(limit: number): Promise<void> {
  const sharedRedis = await getRedisConnection();
  const redis = sharedRedis.duplicate();

  try {
    await redis.set(QUEUE_CAPACITY_LIMIT_KEY, String(limit));
  } finally {
    await redis.quit();
  }
}

/**
 * Add a monitor execution task to the MONITOR_EXECUTION_QUEUE.
 */
export async function addMonitorExecutionJobToQueue(
  task: MonitorJobData
): Promise<string> {
  // Adding monitor execution job

  try {
    const { monitorExecutionQueue } = await getQueues();

    // Multi-location execution is the default behavior
    const monitorConfig = (task.config as MonitorConfig | undefined) ?? undefined;
    const locationConfig = (monitorConfig?.locationConfig as LocationConfig | null) ?? null;
    const effectiveLocations = getEffectiveLocations(locationConfig);

    const expectedLocations = Array.from(
      new Set(
        effectiveLocations.filter((location) => isMonitoringLocation(location))
      )
    ) as MonitoringLocation[];

    const executionGroupId = `${task.monitorId}-${Date.now()}-${Buffer.from(
      crypto.randomBytes(6)
    ).toString("hex")}`;

    const locationsToSchedule =
      expectedLocations.length > 0 ? expectedLocations : getEffectiveLocations(null);

    await Promise.all(
      locationsToSchedule.map(async (location) => {
        // Location is already uppercase MonitorRegion string
        const monitorQueue = monitorExecutionQueue[location as MonitorRegion];

        return monitorQueue.add(
          "executeMonitorJob",
          {
            ...task,
            executionLocation: location,
            executionGroupId,
            expectedLocations: locationsToSchedule,
          },
          {
            jobId: `${task.monitorId}:${executionGroupId}:${location}`,
            // Use default retention policy; only override priority
            priority: 1,
          }
        );
      })
    );

    return executionGroupId;
  } catch (error) {
    queueLogger.error({ err: error, monitorId: task.monitorId },
      `Error adding monitor execution job for monitor ${task.monitorId}`);
    throw new Error(
      `Failed to add monitor execution job: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}


