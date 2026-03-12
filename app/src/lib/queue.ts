import crypto from "crypto";
import { Queue, QueueEvents } from "bullmq";
import Redis, { RedisOptions } from "ioredis";
import type {
  LocationConfig,
  MonitorConfig,
  MonitoringLocation,
} from "@/db/schema";
import type { JobType as SchemaJobType } from "@/db/schema";
import { createLogger } from "./logger/index";
import {
  getAllEnabledLocationCodes,
  getDefaultLocationCodes,
  getFirstDefaultLocationCode,
  getProjectAvailableLocationCodes,
  hasProjectLocationRestrictions,
} from "./location-registry";

// Local interface for cleanup queues (separate from capacity management)
interface CleanupQueues {
  playwrightQueues: Record<string, Queue>;
  k6Queues: Record<string, Queue>;
  monitorExecution: Record<string, Queue>;
  jobSchedulerQueue: Queue;
  k6JobSchedulerQueue: Queue;
  monitorSchedulerQueue: Queue;
  emailTemplateQueue: Queue;
  dataLifecycleCleanupQueue: Queue;
}

// Import QueuedJobData type for queued job storage
import type { QueuedJobData } from "./capacity-manager";

// Create queue logger
export const queueLogger = createLogger({ module: "queue-client" }) as {
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
  projectId?: string;
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
  variables?: Record<string, string>; // Resolved variables for k6 execution
  secrets?: Record<string, string>; // Resolved secrets for k6 execution
  jobId?: string | null;
  tests: Array<{ id: string; script: string }>;
  location?: string | null;
  jobType?: string;
}

// Constants for queue names and Redis keys
// Note: Monitor and K6 queues are created dynamically from enabled locations in the DB

// Scheduler-related queues
export const JOB_SCHEDULER_QUEUE = "job-scheduler";
export const K6_JOB_SCHEDULER_QUEUE = "k6-job-scheduler";
export const MONITOR_SCHEDULER_QUEUE = "monitor-scheduler";

// Email template rendering queue
export const EMAIL_TEMPLATE_QUEUE = "email-template-render";

// Data lifecycle cleanup queue
export const DATA_LIFECYCLE_CLEANUP_QUEUE = "data-lifecycle-cleanup";

// Queue name builders — must stay aligned with worker constants:
// worker/src/k6/k6.constants.ts and worker/src/monitor/monitor.constants.ts
export const PLAYWRIGHT_QUEUE = "playwright-global";
export const K6_GLOBAL_QUEUE = "k6-global";
export function k6QueueName(locationCode: string): string {
  return `k6-${locationCode}`;
}
export function monitorQueueName(locationCode: string): string {
  return `monitor-${locationCode}`;
}

// Redis capacity limit keys
export const RUNNING_CAPACITY_LIMIT_KEY = "supercheck:capacity:running";
export const QUEUE_CAPACITY_LIMIT_KEY = "supercheck:capacity:queued";

// Redis key TTL values (in seconds) - applies to both job and test execution
export const REDIS_JOB_KEY_TTL = 7 * 24 * 60 * 60; // 7 days for job data (completed/failed jobs)
export const REDIS_EVENT_KEY_TTL = 24 * 60 * 60; // 24 hours for events/stats
export const REDIS_METRICS_TTL = 48 * 60 * 60; // 48 hours for metrics data
export const REDIS_CLEANUP_BATCH_SIZE = 100; // Process keys in smaller batches to reduce memory pressure



// Singleton instances
let redisClient: Redis | null = null;

// Region-specific queues
const playwrightQueues: Record<string, Queue> = {};
const k6Queues: Record<string, Queue> = {};

let monitorExecution: Record<string, Queue> | null = null;
let jobSchedulerQueue: Queue | null = null;
let k6JobSchedulerQueue: Queue | null = null;
let monitorSchedulerQueue: Queue | null = null;
let emailTemplateQueue: Queue | null = null;
let dataLifecycleCleanupQueue: Queue | null = null;

let monitorExecutionEvents: Record<string, QueueEvents> | null = null;
let executionQueueEvents: QueueEvents[] = [];

// Store initialization promise to prevent race conditions
let initPromise: Promise<void> | null = null;
let queueShutdownHandlersAttached = false;

// Queue event subscription type
export type QueueEventType = "test" | "job";

export function buildRedisOptions(
  overrides: Partial<RedisOptions> = {}
): RedisOptions {
  const host = process.env.REDIS_HOST || "localhost";
  const port = parseInt(process.env.REDIS_PORT || "6379");
  const password = process.env.REDIS_PASSWORD;
  const tlsEnabled = process.env.REDIS_TLS_ENABLED === "true";
  const tlsRejectUnauthorized =
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false";

  return {
    host,
    port,
    password: password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000,
    // NOTE: Do NOT add commandTimeout here. QueueEvents connections are created
    // via redisClient.duplicate() and inherit these options. commandTimeout would
    // conflict with QueueEvents' blocking XREAD commands (10s default block),
    // causing "Command timed out" errors every cycle.
    // Enable TLS for cloud Redis (Upstash, Redis Cloud, etc.)
    ...(tlsEnabled && {
      tls: {
        rejectUnauthorized: tlsRejectUnauthorized,
      },
    }),
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
 *
 * IMPORTANT: This connection is shared by the CapacityManager, BullMQ queues,
 * and other consumers. We must NOT call quit() on a connection that is merely
 * reconnecting — ioredis's retryStrategy handles transient disconnections
 * (e.g., Sentinel failover). Calling quit() permanently closes the connection
 * for ALL holders of that reference, causing "Connection is closed" errors.
 *
 * We only replace the client when its status is "end" (quit() was already
 * called externally, or ioredis gave up reconnecting).
 */
export async function getRedisConnection(): Promise<Redis> {
  if (redisClient && redisClient.status !== "end") {
    return redisClient;
  }

  if (redisClient) {
    try {
      redisClient.disconnect();
    } catch (e) {
      queueLogger.error({ err: e }, "Error disconnecting old Redis client");
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
    queueLogger.error(
      { err: err },
      "[Queue Client] Failed initial Redis connection:"
    );
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
  monitorExecutionQueue: Record<string, Queue>;
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
            type: "exponential",
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
        const playwrightQueue = new Queue(PLAYWRIGHT_QUEUE, queueSettings);
        playwrightQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "Playwright Queue Error")
        );
        playwrightQueues["global"] = playwrightQueue;

        // K6 - Dynamic regional queues from DB + "global" for any-location routing
        const locationCodes = await getAllEnabledLocationCodes();
        const k6Locations = [...locationCodes, "global"];
        for (const loc of k6Locations) {
          const queueName = k6QueueName(loc);
          const k6Queue = new Queue(queueName, queueSettings);
          k6Queue.on("error", (error) =>
            queueLogger.error({ err: error }, `k6 Queue (${loc}) Error`)
          );
          k6Queues[loc] = k6Queue;
        }

        // Monitor Execution - Dynamic regional queues from DB (no global - monitors are location-specific)
        const monitorQueues: Record<string, Queue> = {};
        for (const loc of locationCodes) {
          const queueName = monitorQueueName(loc);
          const monitorQueue = new Queue(queueName, queueSettings);
          monitorQueue.on("error", (error) =>
            queueLogger.error({ err: error }, `Monitor Queue (${loc}) Error`)
          );
          monitorQueues[loc] = monitorQueue;
        }

        monitorExecution = monitorQueues;

        // Schedulers
        jobSchedulerQueue = new Queue(JOB_SCHEDULER_QUEUE, queueSettings);
        k6JobSchedulerQueue = new Queue(K6_JOB_SCHEDULER_QUEUE, queueSettings);
        monitorSchedulerQueue = new Queue(
          MONITOR_SCHEDULER_QUEUE,
          queueSettings
        );

        // Email template rendering queue
        emailTemplateQueue = new Queue(EMAIL_TEMPLATE_QUEUE, queueSettings);

        // Data lifecycle cleanup queue
        dataLifecycleCleanupQueue = new Queue(
          DATA_LIFECYCLE_CLEANUP_QUEUE,
          queueSettings
        );

        // Monitor Execution Events - Dynamic regional (no global)
        const monitorEvents: Record<string, QueueEvents> = {};
        for (const loc of locationCodes) {
          const eventsConnection = redisClient!.duplicate();
          monitorEvents[loc] = new QueueEvents(monitorQueueName(loc), {
            connection: eventsConnection,
          });
        }
        monitorExecutionEvents = monitorEvents;

        // Create QueueEvents for execution queues
        const playwrightEvents: Record<string, QueueEvents> = {};
        playwrightEvents["global"] = new QueueEvents(PLAYWRIGHT_QUEUE, {
          connection: redisClient!.duplicate(),
        });

        const k6Events: Record<string, QueueEvents> = {};
        for (const loc of k6Locations) {
          k6Events[loc] = new QueueEvents(k6QueueName(loc), {
            connection: redisClient!.duplicate(),
          });
        }

        // Track execution QueueEvents so they can be closed cleanly on shutdown/reload
        executionQueueEvents = [
          playwrightEvents["global"],
          ...Object.values(k6Events),
        ];

        // Add error listeners for dynamic monitor queues
        for (const loc of locationCodes) {
          monitorExecution[loc].on("error", (error: Error) =>
            queueLogger.error(
              { err: error, region: loc },
              `Monitor Queue (${loc}) Error`
            )
          );
          monitorExecutionEvents[loc].on("error", (error: Error) =>
            queueLogger.error(
              { err: error, region: loc },
              `Monitor Events (${loc}) Error`
            )
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
          queueLogger.error(
            { err: error },
            "Data Lifecycle Cleanup Queue Error"
          )
        );

        // Set up periodic cleanup for orphaned Redis keys
        await setupQueueCleanup(connection, {
          playwrightQueues,
          k6Queues,
          monitorExecution: monitorExecution!,
          jobSchedulerQueue,
          k6JobSchedulerQueue,
          monitorSchedulerQueue,
          emailTemplateQueue,
          dataLifecycleCleanupQueue,
        });

        // Set up capacity management with atomic counters (pass queues to prevent circular dependency)
        const { setupCapacityManagement } = await import("./capacity-manager");

        await setupCapacityManagement(
          {
            playwrightQueues,
            k6Queues,
          },
          {
            playwrightEvents,
            k6Events,
          }
        );

        // Initialize scheduler workers asynchronously (non-blocking)
        // This prevents slow/failing Redis from blocking app startup
        // Schedulers will start in background - app remains responsive for health checks
        import("./scheduler")
          .then(({ initializeSchedulerWorkers }) =>
            initializeSchedulerWorkers()
          )
          .then(() =>
            queueLogger.info({}, "Scheduler workers initialized successfully")
          )
          .catch((err) =>
            queueLogger.error(
              { err },
              "Scheduler worker initialization failed (non-fatal)"
            )
          );

        // Attach graceful shutdown handlers once
        if (!queueShutdownHandlersAttached) {
          queueShutdownHandlersAttached = true;

          const handleShutdown = (signal: string) => {
            queueLogger.info({ signal }, "Graceful queue shutdown requested");
            void closeQueue();
          };

          process.once("SIGINT", () => handleShutdown("SIGINT"));
          process.once("SIGTERM", () => handleShutdown("SIGTERM"));
        }

        // BullMQ Queues initialized
      } catch (error) {
        queueLogger.error(
          { err: error },
          "[Queue Client] Failed to initialize queues:"
        );
        // Reset promise to allow retrying later
        initPromise = null;
        throw error; // Re-throw to indicate failure
      }
    })();
  }
  await initPromise;

  if (
    Object.keys(playwrightQueues).length !== 1 || // Single GLOBAL queue
    Object.keys(k6Queues).length === 0 || // Dynamic location queues + global
    !monitorExecution || // Must be initialized (can be empty if no locations)
    !monitorExecutionEvents || // Must be initialized (can be empty if no locations)
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

  if (Object.keys(monitorExecution).length === 0) {
    queueLogger.warn(
      {},
      "No monitor execution queues initialized (no enabled locations). Monitors will not execute until locations are configured."
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
// Store interval references so they can be cleared during shutdown
let cleanupIntervalRef: ReturnType<typeof setInterval> | null = null;
let reconcileIntervalRef: ReturnType<typeof setInterval> | null = null;

async function setupQueueCleanup(
  connection: Redis,
  queues?: CleanupQueues
): Promise<void> {
  // Only set up cleanup once to prevent multiple process event listeners
  if (cleanupSetupComplete) {
    return;
  }

  cleanupSetupComplete = true;

  try {
    // Run initial cleanup on startup to clear any existing orphaned keys
    await performQueueCleanup(connection);

    // Run initial capacity reconciliation
    try {
      const { reconcileCapacityCounters } = await import("./capacity-manager");
      // Only pass execution queues that participate in capacity tracking
      const capacityQueues = queues
        ? {
            playwrightQueues: queues.playwrightQueues,
            k6Queues: queues.k6Queues,
          }
        : undefined;
      await reconcileCapacityCounters(capacityQueues);
      queueLogger.info({}, "Initial capacity reconciliation completed");
    } catch (error) {
      queueLogger.warn(
        { err: error },
        "Initial capacity reconciliation failed (non-fatal)"
      );
    }

    // Schedule queue cleanup every 12 hours (43200000 ms)
    cleanupIntervalRef = setInterval(
      async () => {
        try {
          await performQueueCleanup(connection);
        } catch (error) {
          queueLogger.error(
            { err: error },
            "Error during scheduled queue cleanup"
          );
        }
      },
      12 * 60 * 60 * 1000
    ); // Run cleanup every 12 hours

    // Schedule capacity reconciliation every 5 minutes
    // This helps detect and auto-correct any counter drift quickly
    reconcileIntervalRef = setInterval(
      async () => {
        try {
          const { reconcileCapacityCounters } = await import(
            "./capacity-manager"
          );
          // Only pass execution queues that participate in capacity tracking
          const capacityQueues = queues
            ? {
                playwrightQueues: queues.playwrightQueues,
                k6Queues: queues.k6Queues,
              }
            : undefined;
          await reconcileCapacityCounters(capacityQueues);
        } catch (error) {
          queueLogger.error(
            { err: error },
            "Error during scheduled capacity reconciliation"
          );
        }
      },
      5 * 60 * 1000
    ); // Run reconciliation every 5 minutes

    // Make sure intervals are properly cleared on process exit
    // Use process.once to prevent duplicate listeners
    process.once("exit", () => {
      if (cleanupIntervalRef) clearInterval(cleanupIntervalRef);
      if (reconcileIntervalRef) clearInterval(reconcileIntervalRef);
    });
  } catch (error) {
    queueLogger.error(
      { err: error },
      "[Queue Client] Failed to set up queue cleanup:"
    );
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
      name: k6QueueName(region),
      queue,
    })),
    // Add regional monitor queues
    ...Object.entries(monitorExecution || {}).map(([region, queue]) => ({
      name: monitorQueueName(region),
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
    // K6 uses regional queues — "global" only when explicitly requested or omitted
    const regionStr = (location || "global").toLowerCase();

    const queue = queues.k6Queues[regionStr];
    if (!queue) {
      throw new Error(
        `K6 execution queue "${regionStr}" is not available. ` +
        `Available queues: ${Object.keys(queues.k6Queues).join(", ") || "none"}`
      );
    }
    return queue;
  }
}

/**
 * Add a test execution task to the queue.
 * Test executions participate in the shared parallel execution capacity.
 *
 * @returns Promise resolving to { runId, status } where status is 'running' or 'queued'
 */
export async function addTestToQueue(task: TestExecutionTask): Promise<{
  runId: string;
  status: "running" | "queued";
  position?: number;
}> {
  const jobId = task.runId ?? task.testId;
  const orgId = task.organizationId || "global";

  try {
    const { getCapacityManager } = await import("./capacity-manager");
    const capacityManager = await getCapacityManager();

    // Check capacity atomically
    const result = await capacityManager.reserveSlot(orgId);

    if (result === 0) {
      // Queue is full
      const usage = await capacityManager.getCurrentUsage(orgId);
      throw new Error(
        `Queue capacity limit reached (${usage.queued}/${usage.queuedCapacity} queued). ` +
          `Please try again when running capacity (${usage.running}/${usage.runningCapacity}) is available.`
      );
    }

    if (result === 1) {
      // Can run immediately - add to BullMQ
      try {
        // Track organization immediately to avoid race conditions (Bug 5)
        await capacityManager.trackJobOrganization(jobId, orgId);

        const queues = await getQueues();
        const queue = getQueue(queues, "playwright", task.location);

        await queue.add(
          jobId,
          {
            ...task,
            _capacityStatus: "immediate",
          },
          { jobId }
        );

        return { runId: jobId, status: "running" };
      } catch (error) {
        // Release slot if adding to queue fails (Bug 4)
        await capacityManager.releaseRunningSlot(orgId, jobId);
        throw error;
      }
    }

    // result === 2: Must queue - store in Redis for background processor
    const queuedJobData: QueuedJobData = {
      type: "playwright",
      jobId,
      runId: jobId,
      organizationId: orgId,
      projectId: task.projectId || "",
      taskData: task as unknown as Record<string, unknown>,
      queuedAt: Date.now(),
    };

    const position = await capacityManager.addToQueue(orgId, queuedJobData);
    queueLogger.info(
      { jobId, orgId, position },
      "Job queued for background processing"
    );

    return { runId: jobId, status: "queued", position };
  } catch (error) {
    queueLogger.error(
      { err: error, jobId },
      `Error adding test ${jobId} to queue`
    );
    throw new Error(
      `Failed to add test execution job: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Add a job execution task (multiple tests) to the queue.
 *
 * @returns Promise resolving to { runId, status } where status is 'running' or 'queued'
 */
export async function addJobToQueue(task: JobExecutionTask): Promise<{
  runId: string;
  status: "running" | "queued";
  position?: number;
}> {
  const runId = task.runId;
  const orgId = task.organizationId || "global";

  try {
    const { getCapacityManager } = await import("./capacity-manager");
    const capacityManager = await getCapacityManager();

    const result = await capacityManager.reserveSlot(orgId);

    if (result === 0) {
      const usage = await capacityManager.getCurrentUsage(orgId);
      throw new Error(
        `Queue capacity limit reached (${usage.queued}/${usage.queuedCapacity} queued). ` +
          `Please try again when running capacity (${usage.running}/${usage.runningCapacity}) is available.`
      );
    }

    if (result === 1) {
      try {
        // Track organization immediately to avoid race conditions (Bug 5)
        await capacityManager.trackJobOrganization(runId, orgId);

        const queues = await getQueues();
        const queue = getQueue(queues, "playwright", task.location);

        await queue.add(
          runId,
          {
            ...task,
            _capacityStatus: "immediate",
          },
          { jobId: runId }
        );

        return { runId, status: "running" };
      } catch (error) {
        // Release slot if adding to queue fails (Bug 4)
        await capacityManager.releaseRunningSlot(orgId, runId);
        throw error;
      }
    }

    // Must queue
    const queuedJobData: QueuedJobData = {
      type: "playwright",
      jobId: runId,
      runId,
      organizationId: orgId,
      projectId: task.projectId || "",
      taskData: task as unknown as Record<string, unknown>,
      queuedAt: Date.now(),
    };

    const position = await capacityManager.addToQueue(orgId, queuedJobData);
    queueLogger.info(
      { runId, orgId, position },
      "Job queued for background processing"
    );

    return { runId, status: "queued", position };
  } catch (error) {
    queueLogger.error(
      { err: error, runId },
      `Error adding job ${runId} to queue`
    );
    throw new Error(
      `Failed to add job execution: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Add a k6 performance test execution task to the dedicated queue.
 *
 * @returns Promise resolving to { runId, status } where status is 'running' or 'queued'
 */
export async function addK6TestToQueue(
  task: K6ExecutionTask,
  jobName = "k6-test-execution"
): Promise<{
  runId: string;
  status: "running" | "queued";
  position?: number;
}> {
  const runId = task.runId;
  const orgId = task.organizationId || "global";

  // Resolve the queue location: use caller-provided location, or fall back to DB default.
  const k6TestLocation = task.location || await getFirstDefaultLocationCode();

  try {
    const { getCapacityManager } = await import("./capacity-manager");
    const capacityManager = await getCapacityManager();

    const result = await capacityManager.reserveSlot(orgId);

    if (result === 0) {
      const usage = await capacityManager.getCurrentUsage(orgId);
      throw new Error(
        `Queue capacity limit reached (${usage.queued}/${usage.queuedCapacity} queued). ` +
          `Please try again when running capacity (${usage.running}/${usage.runningCapacity}) is available.`
      );
    }

    if (result === 1) {
      try {
        // Track organization immediately to avoid race conditions (Bug 5)
        await capacityManager.trackJobOrganization(runId, orgId);

        const queues = await getQueues();
        const queue = getQueue(queues, "k6", k6TestLocation);

        await queue.add(
          jobName,
          {
            ...task,
            location: k6TestLocation,
            _capacityStatus: "immediate",
          },
          { jobId: runId }
        );

        return { runId, status: "running" };
      } catch (error) {
        // Release slot if adding to queue fails (Bug 4)
        await capacityManager.releaseRunningSlot(orgId, runId);
        throw error;
      }
    }

    // Must queue
    const queuedJobData: QueuedJobData = {
      type: "k6",
      jobId: runId,
      runId,
      organizationId: orgId,
      projectId: task.projectId || "",
      taskData: { ...task, _jobName: jobName, location: k6TestLocation } as unknown as Record<
        string,
        unknown
      >,
      queuedAt: Date.now(),
    };

    const position = await capacityManager.addToQueue(orgId, queuedJobData);
    queueLogger.info(
      { runId, orgId, position },
      "K6 test queued for background processing"
    );

    return { runId, status: "queued", position };
  } catch (error) {
    queueLogger.error(
      { err: error, runId },
      `Error adding k6 test ${runId} to queue`
    );
    throw new Error(
      `Failed to add k6 test execution: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Add a k6 performance job execution task to the dedicated queue.
 *
 * Respects the caller-provided `task.location` (already resolved by the API route
 * via `resolveProjectK6Location()` which enforces project location restrictions).
 * Falls back to the instance's first default location only when no location is specified.
 *
 * @returns Promise resolving to { runId, status } where status is 'running' or 'queued'
 */
export async function addK6JobToQueue(
  task: K6ExecutionTask,
  jobName = "k6-job-execution"
): Promise<{
  runId: string;
  status: "running" | "queued";
  position?: number;
}> {
  const runId = task.runId;
  const orgId = task.organizationId || "global";

  // Respect the caller-provided location (already validated by resolveProjectK6Location);
  // fall back to the instance default only when no location was specified.
  const k6JobLocation = task.location || await getFirstDefaultLocationCode();

  try {
    const { getCapacityManager } = await import("./capacity-manager");
    const capacityManager = await getCapacityManager();

    const result = await capacityManager.reserveSlot(orgId);

    if (result === 0) {
      const usage = await capacityManager.getCurrentUsage(orgId);
      throw new Error(
        `Queue capacity limit reached (${usage.queued}/${usage.queuedCapacity} queued). ` +
          `Please try again when running capacity (${usage.running}/${usage.runningCapacity}) is available.`
      );
    }

    if (result === 1) {
      try {
        // Track organization immediately to avoid race conditions (Bug 5)
        await capacityManager.trackJobOrganization(runId, orgId);

        const queues = await getQueues();
        const queue = getQueue(queues, "k6", k6JobLocation);

        await queue.add(
          jobName,
          {
            ...task,
            location: k6JobLocation,
            _capacityStatus: "immediate",
          },
          { jobId: runId }
        );

        return { runId, status: "running" };
      } catch (error) {
        // Release slot if adding to queue fails (Bug 4)
        await capacityManager.releaseRunningSlot(orgId, runId);
        throw error;
      }
    }

    // Must queue
    const queuedJobData: QueuedJobData = {
      type: "k6",
      jobId: runId,
      runId,
      organizationId: orgId,
      projectId: task.projectId || "",
      taskData: {
        ...task,
        _jobName: jobName,
        location: k6JobLocation,
      } as unknown as Record<string, unknown>,
      queuedAt: Date.now(),
    };

    const position = await capacityManager.addToQueue(orgId, queuedJobData);
    queueLogger.info(
      { runId, orgId, position },
      "K6 job queued for background processing"
    );

    return { runId, status: "queued", position };
  } catch (error) {
    queueLogger.error(
      { err: error, runId },
      `Error adding k6 job ${runId} to queue`
    );
    throw new Error(
      `Failed to add k6 job execution: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Removed verifyQueueCapacityOrThrow - capacity management is now handled directly in add*ToQueue functions
// Remove dead code: CapacityResult type moved to capacity-manager.ts

/**
 * Invalidate queue maps so they get rebuilt from the DB on next getQueues() call.
 * Call this after location CRUD operations (create, update, delete).
 *
 * Closes all Queue and QueueEvents instances (dynamic + static) so the init block
 * can recreate them cleanly. Preserves the Redis connection, cleanup intervals,
 * scheduler workers, and capacity manager since those are long-lived singletons.
 */
export async function invalidateQueueMaps(): Promise<void> {
  // Wait for any in-flight initialization first
  if (initPromise) {
    try {
      await initPromise;
    } catch {
      // Ignore — we're resetting anyway
    }
  }

  const closePromises: Promise<void>[] = [];

  // Close all Queue instances (dynamic + static)
  for (const [key, queue] of Object.entries(playwrightQueues)) {
    closePromises.push(queue.close().catch((err) =>
      queueLogger.warn({ err, queue: `playwright-${key}` }, "Error closing queue during invalidation")
    ));
    delete playwrightQueues[key];
  }
  for (const [key, queue] of Object.entries(k6Queues)) {
    closePromises.push(queue.close().catch((err) =>
      queueLogger.warn({ err, queue: k6QueueName(key) }, "Error closing queue during invalidation")
    ));
    delete k6Queues[key];
  }
  if (monitorExecution) {
    for (const queue of Object.values(monitorExecution)) {
      closePromises.push(queue.close().catch(() => {}));
    }
    monitorExecution = null;
  }
  if (jobSchedulerQueue) { closePromises.push(jobSchedulerQueue.close().catch(() => {})); jobSchedulerQueue = null; }
  if (k6JobSchedulerQueue) { closePromises.push(k6JobSchedulerQueue.close().catch(() => {})); k6JobSchedulerQueue = null; }
  if (monitorSchedulerQueue) { closePromises.push(monitorSchedulerQueue.close().catch(() => {})); monitorSchedulerQueue = null; }
  if (emailTemplateQueue) { closePromises.push(emailTemplateQueue.close().catch(() => {})); emailTemplateQueue = null; }
  if (dataLifecycleCleanupQueue) { closePromises.push(dataLifecycleCleanupQueue.close().catch(() => {})); dataLifecycleCleanupQueue = null; }

  // Close all QueueEvents
  if (monitorExecutionEvents) {
    for (const events of Object.values(monitorExecutionEvents)) {
      closePromises.push(events.close().catch(() => {}));
    }
    monitorExecutionEvents = null;
  }
  for (const events of executionQueueEvents) {
    closePromises.push(events.close().catch(() => {}));
  }
  executionQueueEvents = [];

  await Promise.allSettled(closePromises);

  // Reset initPromise so next getQueues() call re-initializes all queues from fresh DB data.
  // We intentionally keep: redisClient, cleanupSetupComplete, cleanup/reconcile intervals,
  // capacity manager, and scheduler workers — those are long-lived and will work with the
  // new queue objects once they're created.
  initPromise = null;

  // Notify workers via Redis Pub/Sub so they can discover and subscribe to new queues.
  // Include enabled location codes in the message so workers can construct queue names
  // deterministically — SCAN-based discovery may miss new queues whose :meta key hasn't
  // been created yet (BullMQ only writes :meta on the first queue operation).
  try {
    const { getAllEnabledLocationCodes } = await import("@/lib/location-registry");
    const locationCodes = await getAllEnabledLocationCodes();
    const redis = await getRedisConnection();
    await redis.publish("supercheck:queue-refresh", JSON.stringify({ timestamp: Date.now(), locationCodes }));
  } catch (err) {
    queueLogger.warn({ err }, "Failed to publish queue-refresh notification (non-fatal)");
  }

  queueLogger.info({}, "Queue maps invalidated — will rebuild on next getQueues() call");
}

/**
 * Close queue connections (useful for graceful shutdown).
 */
export async function closeQueue(): Promise<void> {
  // Wait for any in-flight initialization to complete before tearing down.
  // Without this, a SIGTERM during startup could leave orphaned queues/connections.
  if (initPromise) {
    try {
      await initPromise;
    } catch {
      // Ignore init errors — we're shutting down anyway
    }
  }

  // Stop background processors before closing connections
  try {
    const { resetCapacityManager } = await import("./capacity-manager");
    resetCapacityManager();
  } catch {
    // capacity-manager may not be loaded yet
  }

  // Shutdown scheduler workers (they hold their own Redis connections)
  try {
    const { shutdownSchedulerWorkers } = await import("./scheduler");
    await shutdownSchedulerWorkers();
  } catch {
    // scheduler may not be initialized
  }

  // Clear periodic cleanup/reconciliation intervals
  if (cleanupIntervalRef) {
    clearInterval(cleanupIntervalRef);
    cleanupIntervalRef = null;
  }
  if (reconcileIntervalRef) {
    clearInterval(reconcileIntervalRef);
    reconcileIntervalRef = null;
  }

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
  if (dataLifecycleCleanupQueue) promises.push(dataLifecycleCleanupQueue.close());
  if (redisClient) promises.push(redisClient.quit());

  // Close all regional monitor events
  if (monitorExecutionEvents) {
    for (const events of Object.values(monitorExecutionEvents)) {
      promises.push(events.close());
    }
  }

  for (const events of executionQueueEvents) {
    promises.push(events.close());
  }

  try {
    await Promise.all(promises);
    // All queues closed
  } catch (error) {
    queueLogger.error(
      { err: error },
      "[Queue Client] Error closing queues and events:"
    );
  } finally {
    // Reset queues
    for (const key in playwrightQueues) delete playwrightQueues[key];
    for (const key in k6Queues) delete k6Queues[key];
    monitorExecution = null;
    jobSchedulerQueue = null;
    k6JobSchedulerQueue = null;
    monitorSchedulerQueue = null;
    emailTemplateQueue = null;
    dataLifecycleCleanupQueue = null;
    redisClient = null;
    initPromise = null;
    monitorExecutionEvents = null;
    executionQueueEvents = [];
    cleanupSetupComplete = false;
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
 * Resolve effective monitor locations from DB, with multi-tier fallback.
 * Validates configured locations against enabled locations in the DB,
 * falling back to defaults → all enabled → "local" if none are valid.
 * When projectId is provided, further restricts to project-allowed locations.
 *
 * Shared logic aligns with monitor-scheduler's getEffectiveLocations.
 */
async function resolveMonitorLocations(
  locationConfig: LocationConfig | null,
  projectId?: string
): Promise<string[]> {
  if (!locationConfig || !locationConfig.enabled) {
    return resolveDefaultMonitorLocations(projectId);
  }

  const configuredLocations = locationConfig.locations;
  if (!configuredLocations || configuredLocations.length === 0) {
    return resolveDefaultMonitorLocations(projectId);
  }

  // Validate configured locations against what's actually enabled in DB
  const enabledCodes = await getAllEnabledLocationCodes();
  let validLocations = configuredLocations.filter((loc) =>
    enabledCodes.includes(loc)
  );

  // Further restrict to project-allowed locations if projectId is provided
  if (projectId && validLocations.length > 0) {
    const projectCodes = await getProjectAvailableLocationCodes(projectId);
    validLocations = validLocations.filter((loc) => projectCodes.includes(loc));
  }

  if (validLocations.length === 0) {
    // All explicitly configured locations are disabled/deleted or restricted.
    // Throw instead of silently falling back to defaults, which would
    // execute the monitor from unintended regions and report misleading
    // latency/availability data. This matches the scheduler's behavior.
    throw new Error(
      `Monitor has locations explicitly configured [${configuredLocations.join(', ')}] ` +
      `but none are currently enabled${projectId ? ' for this project' : ''}. ` +
      `Re-enable the locations or update the monitor's location configuration.`
    );
  }

  return validLocations;
}

/**
 * Get default monitor locations with a safety fallback chain:
 * default locations → all enabled → "local"
 * When projectId is provided and the project has explicit restrictions,
 * filters the resolved defaults to only project-allowed codes.
 */
async function resolveDefaultMonitorLocations(projectId?: string): Promise<string[]> {
  const defaults = await getDefaultLocationCodes();
  let resolved: string[];
  if (defaults.length > 0) {
    resolved = defaults;
  } else {
    const enabled = await getAllEnabledLocationCodes();
    if (enabled.length > 0) {
      resolved = enabled;
    } else {
      const fallback = await getFirstDefaultLocationCode();
      resolved = [fallback];
    }
  }

  // Only filter by project restrictions if the project has explicit restriction rows.
  // Without this check, getProjectAvailableLocationCodes returns ALL enabled locations
  // for unrestricted projects, which would turn single-region defaults into multi-location.
  if (projectId && await hasProjectLocationRestrictions(projectId)) {
    const projectCodes = await getProjectAvailableLocationCodes(projectId);
    const filtered = resolved.filter((loc) => projectCodes.includes(loc));
    if (filtered.length > 0) return filtered;
    // If none of the defaults are in the project's allowed set, return project codes
    if (projectCodes.length > 0) return projectCodes;
  }

  return resolved;
}

/**
 * Add a monitor execution task to regional queues.
 * Monitors are distributed to their specified locations for accurate latency measurement.
 */
export async function addMonitorExecutionJobToQueue(
  task: MonitorJobData
): Promise<string> {
  // Adding monitor execution job

  try {
    const { monitorExecutionQueue } = await getQueues();

    // Resolve effective locations using DB-validated logic (same as monitor-scheduler)
    const monitorConfig =
      (task.config as MonitorConfig | undefined) ?? undefined;
    const locationConfig =
      (monitorConfig?.locationConfig as LocationConfig | null) ?? null;
    const effectiveLocations = await resolveMonitorLocations(locationConfig, task.projectId);

    // Filter to locations that have active queues — fail if none match
    const availableQueueLocations = Object.keys(monitorExecutionQueue);
    const validLocations = effectiveLocations.filter((loc) =>
      availableQueueLocations.includes(loc)
    );

    if (validLocations.length === 0) {
      const missing = effectiveLocations.join(", ");
      const available = availableQueueLocations.join(", ") || "none";
      throw new Error(
        `No monitor execution queues available for configured locations [${missing}]. ` +
        `Available queues: [${available}]. ` +
        `Ensure workers are running in the required regions.`
      );
    }
    const locationsToSchedule = validLocations;

    const executionGroupId = `${task.monitorId}-${Date.now()}-${Buffer.from(
      crypto.randomBytes(6)
    ).toString("hex")}`;

    await Promise.all(
      locationsToSchedule.map(async (location) => {
        const monitorQueue = monitorExecutionQueue[location];

        if (!monitorQueue) {
          queueLogger.warn(
            { location, monitorId: task.monitorId },
            `No monitor queue for location "${location}", skipping`
          );
          return;
        }

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
            priority: 1,
            // Retry configuration for transient failures (network blips, container startup)
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
            // Cleanup completed/failed jobs to prevent Redis memory bloat
            removeOnComplete: { age: 3600 }, // 1 hour
            removeOnFail: { age: 86400 }, // 24 hours
          }
        );
      })
    );

    return executionGroupId;
  } catch (error) {
    queueLogger.error(
      { err: error, monitorId: task.monitorId },
      `Error adding monitor execution job for monitor ${task.monitorId}`
    );
    throw new Error(
      `Failed to add monitor execution job: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
