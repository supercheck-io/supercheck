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
  getFirstDefaultLocationCode,
  invalidateLocationCache,
} from "./location-registry";
import { omitExecutionSecrets } from "./execution-payload";
import { ExecutionQueueError } from "./execution-errors";
import {
  partitionMonitorLocationsByAvailability,
  resolveMonitorLocations,
} from "./monitor-location-routing";

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
import {
  CapacityReservationUnavailableError,
  type QueuedJobData,
} from "./capacity-manager";

function throwExecutionQueueError(error: unknown, operation: string): never {
  if (error instanceof ExecutionQueueError) {
    throw error;
  }

  if (error instanceof CapacityReservationUnavailableError) {
    throw new ExecutionQueueError(
      "capacity_unavailable",
      "Execution capacity service is temporarily unavailable",
      error,
    );
  }

  throw new ExecutionQueueError(
    "queue_unavailable",
    `Execution queue is temporarily unavailable during ${operation}`,
    error,
  );
}

// Create queue logger
export const queueLogger = createLogger({ module: "queue-client" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

// Interfaces matching those in the worker service
export interface FileVariableInfo {
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number | null;
}

export interface TestExecutionTask {
  testId: string;
  code: string; // Pass code directly
  variables?: Record<string, string>; // Resolved variables for the test
  secrets?: Record<string, string>; // Resolved secrets for the test
  files?: Record<string, FileVariableInfo>; // File variable metadata for the test
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
  files?: Record<string, FileVariableInfo>; // File variable metadata for job execution
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
  files?: Record<string, FileVariableInfo>; // File variable metadata for k6 execution
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

/**
 * Get the set of queue names that have active worker heartbeats.
 * Delegates to worker-registry to avoid duplicating the Redis scan logic.
 * Uses lazy import to avoid circular dependency at module-evaluation time.
 */
async function getActiveWorkerQueueNamesFromRegistry(): Promise<Set<string>> {
  const { getActiveWorkerQueueNames } = await import("@/lib/worker-registry");
  return getActiveWorkerQueueNames();
}

async function assertK6QueueAvailable(location: string): Promise<void> {
  let activeQueueNames: Set<string>;
  try {
    activeQueueNames = await getActiveWorkerQueueNamesFromRegistry();
  } catch {
    // Redis heartbeat scan failed — allow the job to be enqueued anyway.
    // BullMQ will hold it until a worker picks it up.
    queueLogger.warn(
      { location },
      "[assertK6QueueAvailable] Heartbeat lookup failed — skipping active-worker check"
    );
    return;
  }

  const queueName = location === "global" ? K6_GLOBAL_QUEUE : k6QueueName(location);

  if (!activeQueueNames.has(queueName)) {
    // Log a warning but do NOT hard-fail. Worker heartbeat queue lists are
    // refreshed on a 30s interval, so there is a brief window after a worker
    // starts consuming a new queue before the heartbeat advertises it.
    // Throwing here would reject valid K6 runs during that window.
    queueLogger.warn(
      { queueName, location, activeQueues: Array.from(activeQueueNames) },
      "[assertK6QueueAvailable] No heartbeat found for queue — job will be enqueued but may wait for a worker"
    );
  }
}

// Redis capacity limit keys
export const RUNNING_CAPACITY_LIMIT_KEY = "supercheck:capacity:running";
export const QUEUE_CAPACITY_LIMIT_KEY = "supercheck:capacity:queued";

// Redis key TTL values (in seconds) - applies to both job and test execution
export const REDIS_JOB_KEY_TTL = 7 * 24 * 60 * 60; // 7 days for job data (completed/failed jobs)
export const REDIS_EVENT_KEY_TTL = 24 * 60 * 60; // 24 hours for events/stats
export const REDIS_METRICS_TTL = 48 * 60 * 60; // 48 hours for metrics data
export const REDIS_CLEANUP_BATCH_SIZE = 100; // Process keys in smaller batches to reduce memory pressure

/** Redis pub/sub channel that wakes every app replica and regional worker. */
export const QUEUE_REFRESH_CHANNEL = "supercheck:queue-refresh";

/** Stable identity for the enabled-location set used to build queues. */
export function locationCodesSignature(codes: readonly string[]): string {
  return [...codes].map((code) => code.toLowerCase()).sort().join("\0");
}

export function getQueueLocationSignature(): string | null {
  return getQueueSingleton().locationSignature;
}



// Shared across Next.js server chunks. Module-level lets are duplicated per
// bundle, so one replica can invalidate queues the dashboard bundle never sees.
type QueueSingleton = {
  redisClient: Redis | null;
  playwrightQueues: Record<string, Queue>;
  k6Queues: Record<string, Queue>;
  capacityK6Queues: Record<string, Queue>;
  retiredK6At: Record<string, number>;
  monitorExecution: Record<string, Queue> | null;
  jobSchedulerQueue: Queue | null;
  k6JobSchedulerQueue: Queue | null;
  monitorSchedulerQueue: Queue | null;
  emailTemplateQueue: Queue | null;
  dataLifecycleCleanupQueue: Queue | null;
  monitorExecutionEvents: Record<string, QueueEvents> | null;
  executionQueueEvents: QueueEvents[];
  initPromise: Promise<void> | null;
  refreshPromise: Promise<void> | null;
  refreshGeneration: number;
  queueShutdownHandlersAttached: boolean;
  cleanupSetupComplete: boolean;
  cleanupIntervalRef: ReturnType<typeof setInterval> | null;
  reconcileIntervalRef: ReturnType<typeof setInterval> | null;
  locationSignature: string | null;
  instanceId: string;
  refreshSubscriber: Redis | null;
  refreshSubscriberStarting: boolean;
  refreshReconcileTimer: ReturnType<typeof setInterval> | null;
};

const QUEUE_SINGLETON_KEY = "__SUPERCHECK_QUEUE_SINGLETON__";

function createQueueSingleton(): QueueSingleton {
  return {
    redisClient: null,
    playwrightQueues: {},
    k6Queues: {},
    capacityK6Queues: {},
    retiredK6At: {},
    monitorExecution: null,
    jobSchedulerQueue: null,
    k6JobSchedulerQueue: null,
    monitorSchedulerQueue: null,
    emailTemplateQueue: null,
    dataLifecycleCleanupQueue: null,
    monitorExecutionEvents: null,
    executionQueueEvents: [],
    initPromise: null,
    refreshPromise: null,
    refreshGeneration: 0,
    queueShutdownHandlersAttached: false,
    cleanupSetupComplete: false,
    cleanupIntervalRef: null,
    reconcileIntervalRef: null,
    locationSignature: null,
    instanceId: crypto.randomUUID(),
    refreshSubscriber: null,
    refreshSubscriberStarting: false,
    refreshReconcileTimer: null,
  };
}

function getQueueSingleton(): QueueSingleton {
  const scope = globalThis as typeof globalThis & {
    [QUEUE_SINGLETON_KEY]?: QueueSingleton;
  };
  if (!scope[QUEUE_SINGLETON_KEY]) {
    scope[QUEUE_SINGLETON_KEY] = createQueueSingleton();
  }
  return scope[QUEUE_SINGLETON_KEY];
}

const queueState = getQueueSingleton();

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
  const sentinels = process.env.REDIS_SENTINELS?.split(",").map((entry) => {
    const trimmed = entry.trim();
    const separator = trimmed.lastIndexOf(":");
    const sentinelHost = trimmed.slice(0, separator);
    const sentinelPort = Number(trimmed.slice(separator + 1));
    if (
      separator <= 0 ||
      !sentinelHost ||
      !Number.isInteger(sentinelPort) ||
      sentinelPort < 1 ||
      sentinelPort > 65535
    ) {
      throw new Error(`Invalid REDIS_SENTINELS entry: ${trimmed}`);
    }
    return { host: sentinelHost, port: sentinelPort };
  });

  return {
    ...(sentinels?.length
      ? {
          sentinels,
          name: process.env.REDIS_SENTINEL_MASTER || "mymaster",
          sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || undefined,
          sentinelRetryStrategy: (times: number) => Math.min(times * 250, 3000),
        }
      : { host, port }),
    password: password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000,
    // NOTE: Do NOT add commandTimeout here. QueueEvents connections are created
    // via queueState.redisClient.duplicate() and inherit these options. commandTimeout would
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
  if (queueState.redisClient && queueState.redisClient.status !== "end") {
    return queueState.redisClient;
  }

  if (queueState.redisClient) {
    try {
      queueState.redisClient.disconnect();
    } catch (e) {
      queueLogger.error({ err: e }, "Error disconnecting old Redis client");
    }
    queueState.redisClient = null;
  }

  const connectionOpts = buildRedisOptions();

  queueState.redisClient = new Redis(connectionOpts);

  queueState.redisClient.on("error", (err) =>
    queueLogger.error({ err: err }, "[Queue Client] Redis Error:")
  );
  queueState.redisClient.on("connect", () => {});
  queueState.redisClient.on("ready", async () => {
    // Redis connection is ready
  });
  queueState.redisClient.on("close", () => {});

  // Wait briefly for connection, but don't block indefinitely if Redis is down
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Redis connection timeout")),
        5000
      );
      queueState.redisClient?.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
      queueState.redisClient?.once("error", (err) => {
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

  return queueState.redisClient;
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
  await queueState.refreshPromise?.catch(() => undefined);
  if (!queueState.initPromise) {
    queueState.initPromise = (async () => {
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
        queueState.playwrightQueues["global"] = playwrightQueue;

        // K6 - Dynamic regional queues from DB + "global" for any-location routing
        // Gracefully handle DB unavailability during startup (e.g., Postgres not ready yet).
        // Static queues (playwright, schedulers) still get created; dynamic location queues
        // will be built later via invalidateQueueMaps() or on next getQueues() call.
        let locationCodes: string[];
        let locationFetchFailed = false;
        try {
          locationCodes = await getAllEnabledLocationCodes();
        } catch (locationErr) {
          queueLogger.warn(
            { err: locationErr },
            "[Queue Client] Failed to fetch location codes from DB — creating static queues only. " +
            "Will schedule automatic retry to rebuild dynamic queues."
          );
          locationCodes = [];
          locationFetchFailed = true;
        }
        const k6Locations = [...locationCodes, "global"];
        for (const loc of k6Locations) {
          const queueName = k6QueueName(loc);
          const k6Queue = new Queue(queueName, queueSettings);
          k6Queue.on("error", (error) =>
            queueLogger.error({ err: error }, `k6 Queue (${loc}) Error`)
          );
          queueState.k6Queues[loc] = k6Queue;
          queueState.capacityK6Queues[loc] = k6Queue;
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

        queueState.monitorExecution = monitorQueues;

        // Schedulers
        queueState.jobSchedulerQueue = new Queue(JOB_SCHEDULER_QUEUE, queueSettings);
        queueState.k6JobSchedulerQueue = new Queue(K6_JOB_SCHEDULER_QUEUE, queueSettings);
        queueState.monitorSchedulerQueue = new Queue(
          MONITOR_SCHEDULER_QUEUE,
          queueSettings
        );

        // Email template rendering queue
        queueState.emailTemplateQueue = new Queue(EMAIL_TEMPLATE_QUEUE, queueSettings);

        // Data lifecycle cleanup queue
        queueState.dataLifecycleCleanupQueue = new Queue(
          DATA_LIFECYCLE_CLEANUP_QUEUE,
          queueSettings
        );

        // Monitor Execution Events - Dynamic regional (no global)
        const monitorEvents: Record<string, QueueEvents> = {};
        for (const loc of locationCodes) {
          monitorEvents[loc] = new QueueEvents(monitorQueueName(loc), {
            connection: buildRedisOptions({ lazyConnect: false }),
          });
        }
        queueState.monitorExecutionEvents = monitorEvents;

        // Create QueueEvents for execution queues
        const playwrightEvents: Record<string, QueueEvents> = {};
        playwrightEvents["global"] = new QueueEvents(PLAYWRIGHT_QUEUE, {
          connection: buildRedisOptions({ lazyConnect: false }),
        });

        const k6Events: Record<string, QueueEvents> = {};
        for (const loc of k6Locations) {
          k6Events[loc] = new QueueEvents(k6QueueName(loc), {
            connection: buildRedisOptions({ lazyConnect: false }),
          });
        }

        // Track execution QueueEvents so they can be closed cleanly on shutdown/reload
        queueState.executionQueueEvents = [
          playwrightEvents["global"],
          ...Object.values(k6Events),
        ];
        Object.assign(k6Events, await restoreDisabledCapacityQueues(connection, queueSettings));
        for (const events of queueState.executionQueueEvents) {
          events.on("error", (err) => queueLogger.error({ err, queue: events.name }, "Execution events error"));
        }

        // Add error listeners for dynamic monitor queues
        for (const loc of locationCodes) {
          queueState.monitorExecution[loc].on("error", (error: Error) =>
            queueLogger.error(
              { err: error, region: loc },
              `Monitor Queue (${loc}) Error`
            )
          );
          queueState.monitorExecutionEvents[loc].on("error", (error: Error) =>
            queueLogger.error(
              { err: error, region: loc },
              `Monitor Events (${loc}) Error`
            )
          );
        }

        queueState.jobSchedulerQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "Job Scheduler Queue Error")
        );
        queueState.k6JobSchedulerQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "k6 Job Scheduler Queue Error")
        );
        queueState.monitorSchedulerQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "Monitor Scheduler Queue Error")
        );
        queueState.emailTemplateQueue.on("error", (error) =>
          queueLogger.error({ err: error }, "Email Template Queue Error")
        );
        queueState.dataLifecycleCleanupQueue.on("error", (error) =>
          queueLogger.error(
            { err: error },
            "Data Lifecycle Cleanup Queue Error"
          )
        );

        // Set up periodic cleanup for orphaned Redis keys
        await setupQueueCleanup(connection, {
          playwrightQueues: queueState.playwrightQueues,
          k6Queues: queueState.capacityK6Queues,
          monitorExecution: queueState.monitorExecution!,
          jobSchedulerQueue: queueState.jobSchedulerQueue,
          k6JobSchedulerQueue: queueState.k6JobSchedulerQueue,
          monitorSchedulerQueue: queueState.monitorSchedulerQueue,
          emailTemplateQueue: queueState.emailTemplateQueue,
          dataLifecycleCleanupQueue: queueState.dataLifecycleCleanupQueue,
        });

        // Set up capacity management with atomic counters (pass queues to prevent circular dependency)
        const { setupCapacityManagement } = await import("./capacity-manager");

        await setupCapacityManagement(
          {
            playwrightQueues: queueState.playwrightQueues,
            k6Queues: queueState.capacityK6Queues,
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
        if (!queueState.queueShutdownHandlersAttached) {
          queueState.queueShutdownHandlersAttached = true;

          const handleShutdown = (signal: string) => {
            queueLogger.info({ signal }, "Graceful queue shutdown requested");
            void closeQueue();
          };

          process.once("SIGINT", () => handleShutdown("SIGINT"));
          process.once("SIGTERM", () => handleShutdown("SIGTERM"));
        }

        // Null means DB unavailable; an empty signature is an authoritative empty set.
        queueState.locationSignature = locationFetchFailed
          ? null
          : locationCodesSignature(locationCodes);

        // BullMQ Queues initialized
      } catch (error) {
        queueLogger.error(
          { err: error },
          "[Queue Client] Failed to initialize queues:"
        );
        // Reset promise to allow retrying later
        queueState.initPromise = null;
        throw error; // Re-throw to indicate failure
      }
    })();
  }
  await queueState.initPromise;
  await queueState.refreshPromise?.catch(() => undefined);

  if (
    Object.keys(queueState.playwrightQueues).length !== 1 || // Single GLOBAL queue
    Object.keys(queueState.k6Queues).length === 0 || // Dynamic location queues + global
    !queueState.monitorExecution || // Must be initialized (can be empty if no locations)
    !queueState.monitorExecutionEvents || // Must be initialized (can be empty if no locations)
    !queueState.jobSchedulerQueue ||
    !queueState.k6JobSchedulerQueue ||
    !queueState.monitorSchedulerQueue ||
    !queueState.emailTemplateQueue ||
    !queueState.dataLifecycleCleanupQueue ||
    !queueState.redisClient
  ) {
    throw new Error(
      "One or more queues or event listeners could not be initialized."
    );
  }

  ensureQueueRefreshSubscription();

  if (Object.keys(queueState.monitorExecution).length === 0) {
    queueLogger.warn(
      {},
      "No monitor execution queues initialized (no enabled locations). Monitors will not execute until locations are configured."
    );
  }
  return {
    playwrightQueues: queueState.playwrightQueues,
    k6Queues: queueState.k6Queues,
    monitorExecutionQueue: queueState.monitorExecution,
    jobSchedulerQueue: queueState.jobSchedulerQueue,
    k6JobSchedulerQueue: queueState.k6JobSchedulerQueue,
    monitorSchedulerQueue: queueState.monitorSchedulerQueue,
    emailTemplateQueue: queueState.emailTemplateQueue,
    dataLifecycleCleanupQueue: queueState.dataLifecycleCleanupQueue,
    redisConnection: queueState.redisClient,
  };
}

/** Include disabled regional jobs that still hold admission capacity. */
export async function getCapacityQueues(): Promise<{
  playwrightQueues: Record<string, Queue>;
  k6Queues: Record<string, Queue>;
}> {
  await getQueues();
  return {
    playwrightQueues: queueState.playwrightQueues,
    k6Queues: queueState.capacityK6Queues,
  };
}

/**
 * Sets up periodic cleanup of orphaned Redis keys to prevent unbounded growth
 */

async function setupQueueCleanup(
  connection: Redis,
  queues?: CleanupQueues
): Promise<void> {
  // Only set up cleanup once to prevent multiple process event listeners
  if (queueState.cleanupSetupComplete) {
    return;
  }

  queueState.cleanupSetupComplete = true;

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
    queueState.cleanupIntervalRef = setInterval(
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
    queueState.reconcileIntervalRef = setInterval(
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
      if (queueState.cleanupIntervalRef) clearInterval(queueState.cleanupIntervalRef);
      if (queueState.reconcileIntervalRef) clearInterval(queueState.reconcileIntervalRef);
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
    { name: JOB_SCHEDULER_QUEUE, queue: queueState.jobSchedulerQueue },
    { name: K6_JOB_SCHEDULER_QUEUE, queue: queueState.k6JobSchedulerQueue },
    { name: MONITOR_SCHEDULER_QUEUE, queue: queueState.monitorSchedulerQueue },
    { name: EMAIL_TEMPLATE_QUEUE, queue: queueState.emailTemplateQueue },
    ...Object.entries(queueState.playwrightQueues).map(([region, queue]) => ({
      name: `playwright-${region}`,
      queue,
    })),
    ...Object.entries(queueState.k6Queues).map(([region, queue]) => ({
      name: k6QueueName(region),
      queue,
    })),
    // Add regional monitor queues
    ...Object.entries(queueState.monitorExecution || {}).map(([region, queue]) => ({
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
  const queuedAt = Date.now();
  const safeTask = omitExecutionSecrets(task);

  try {
    const { getCapacityManager } = await import("./capacity-manager");
    const capacityManager = await getCapacityManager();

    // Check capacity atomically
    const result = await capacityManager.reserveSlot(orgId, jobId, queuedAt);

    if (result === 0) {
      // Queue is full
      throw new ExecutionQueueError(
        "capacity_exceeded",
        "Queue capacity limit reached",
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
            ...safeTask,
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
      taskData: safeTask as unknown as Record<string, unknown>,
      queuedAt,
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
    throwExecutionQueueError(error, "test enqueue");
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
  const queuedAt = Date.now();
  const safeTask = omitExecutionSecrets(task);

  try {
    const { getCapacityManager } = await import("./capacity-manager");
    const capacityManager = await getCapacityManager();

    const result = await capacityManager.reserveSlot(orgId, runId, queuedAt);

    if (result === 0) {
      throw new ExecutionQueueError(
        "capacity_exceeded",
        "Queue capacity limit reached",
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
            ...safeTask,
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
      taskData: safeTask as unknown as Record<string, unknown>,
      queuedAt,
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
    throwExecutionQueueError(error, "job enqueue");
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
  const queuedAt = Date.now();
  const safeTask = omitExecutionSecrets(task);

  // Resolve the queue location: use caller-provided location, or fall back to DB default.
  const k6TestLocation = task.location || await getFirstDefaultLocationCode();

  try {
    await assertK6QueueAvailable(k6TestLocation);

    const { getCapacityManager } = await import("./capacity-manager");
    const capacityManager = await getCapacityManager();

    const result = await capacityManager.reserveSlot(orgId, runId, queuedAt);

    if (result === 0) {
      throw new ExecutionQueueError(
        "capacity_exceeded",
        "Queue capacity limit reached",
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
            ...safeTask,
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
      taskData: { ...safeTask, _jobName: jobName, location: k6TestLocation } as unknown as Record<
        string,
        unknown
      >,
      queuedAt,
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
    throwExecutionQueueError(error, "k6 test enqueue");
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
  const queuedAt = Date.now();
  const safeTask = omitExecutionSecrets(task);

  // Respect the caller-provided location (already validated by resolveProjectK6Location);
  // fall back to the instance default only when no location was specified.
  const k6JobLocation = task.location || await getFirstDefaultLocationCode();

  try {
    await assertK6QueueAvailable(k6JobLocation);

    const { getCapacityManager } = await import("./capacity-manager");
    const capacityManager = await getCapacityManager();

    const result = await capacityManager.reserveSlot(orgId, runId, queuedAt);

    if (result === 0) {
      throw new ExecutionQueueError(
        "capacity_exceeded",
        "Queue capacity limit reached",
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
            ...safeTask,
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
        ...safeTask,
        _jobName: jobName,
        location: k6JobLocation,
      } as unknown as Record<string, unknown>,
      queuedAt,
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
    throwExecutionQueueError(error, "k6 job enqueue");
  }
}

// Removed verifyQueueCapacityOrThrow - capacity management is now handled directly in add*ToQueue functions
// Remove dead code: CapacityResult type moved to capacity-manager.ts

/**
 * Refresh regional clients from the database without interrupting global,
 * scheduler, or unchanged regional queues. Concurrent requests wait for refresh.
 */
export async function invalidateQueueMaps(options?: {
  publish?: boolean;
}): Promise<void> {
  const previous = queueState.refreshPromise;
  const generation = queueState.refreshGeneration + 1;
  queueState.refreshGeneration = generation;
  const refresh = (async () => {
    await previous?.catch(() => undefined);
    await queueState.initPromise?.catch(() => undefined);
    invalidateLocationCache();
    const locationCodes = await getAllEnabledLocationCodes();
    if (queueState.initPromise) {
      await refreshRegionalQueues(locationCodes);
    }
    if (options?.publish !== false) {
      try {
        const redis = await getRedisConnection();
        await redis.publish(
          QUEUE_REFRESH_CHANNEL,
          JSON.stringify({
            timestamp: Date.now(),
            locationCodes,
            origin: queueState.instanceId,
          })
        );
      } catch (err) {
        queueLogger.warn({ err }, "Failed to publish queue-refresh notification (non-fatal)");
      }
    }
  })();
  queueState.refreshPromise = refresh;
  try {
    await refresh;
  } finally {
    if (queueState.refreshGeneration === generation) queueState.refreshPromise = null;
  }
}

async function refreshRegionalQueues(locationCodes: string[]): Promise<void> {
  const queueSettings = queueState.k6Queues.global.opts;
  const enabled = new Set(locationCodes);
  const k6Events: Record<string, QueueEvents> = {};
  const monitorQueues = queueState.monitorExecution!;
  const monitorEvents = queueState.monitorExecutionEvents!;

  for (const code of locationCodes) {
    delete queueState.retiredK6At[code];
    if (queueState.capacityK6Queues[code]) {
      queueState.k6Queues[code] = queueState.capacityK6Queues[code];
    } else {
      const queue = new Queue(k6QueueName(code), queueSettings);
      queue.on("error", (err) => queueLogger.error({ err, code }, "K6 queue error"));
      queueState.k6Queues[code] = queue;
      queueState.capacityK6Queues[code] = queue;
      const events = new QueueEvents(k6QueueName(code), { connection: buildRedisOptions({ lazyConnect: false }) });
      events.on("error", (err) => queueLogger.error({ err, code }, "K6 events error"));
      k6Events[code] = events;
      queueState.executionQueueEvents.push(events);
    }
    if (!monitorQueues[code]) {
      const queue = new Queue(monitorQueueName(code), queueSettings);
      queue.on("error", (err) => queueLogger.error({ err, code }, "Monitor queue error"));
      monitorQueues[code] = queue;
      const events = new QueueEvents(monitorQueueName(code), { connection: buildRedisOptions({ lazyConnect: false }) });
      events.on("error", (err) => queueLogger.error({ err, code }, "Monitor events error"));
      monitorEvents[code] = events;
    }
  }

  if (Object.keys(k6Events).length) {
    const { setupCapacityManagement } = await import("./capacity-manager");
    await setupCapacityManagement(
      { playwrightQueues: queueState.playwrightQueues, k6Queues: queueState.capacityK6Queues },
      { playwrightEvents: {}, k6Events }
    );
  }

  const toClose: Array<Queue | QueueEvents> = [];
  for (const code of Object.keys(queueState.k6Queues)) {
    if (code === "global" || enabled.has(code)) continue;
    // Keep capacity events while active work drains and queued jobs remain.
    queueState.retiredK6At[code] = Date.now();
    delete queueState.k6Queues[code];
  }
  for (const [code, queue] of Object.entries(monitorQueues)) {
    if (enabled.has(code)) continue;
    toClose.push(queue, monitorEvents[code]);
    delete monitorQueues[code];
    delete monitorEvents[code];
  }
  await Promise.all(toClose.map((client) => client.close().catch((err) => {
    queueLogger.warn({ err, queue: client.name }, "Error closing disabled regional client");
  })));
  queueState.locationSignature = locationCodesSignature(locationCodes);
}

/** Recover admitted work in disabled/deleted regions after an app restart. */
async function restoreDisabledCapacityQueues(
  connection: Redis,
  queueSettings: Queue["opts"]
): Promise<Record<string, QueueEvents>> {
  const codes = new Set<string>();
  let cursor = "0";
  do {
    const [next, keys] = await connection.scan(cursor, "MATCH", "bull:k6-*:*", "COUNT", 100);
    cursor = next;
    for (const key of keys) {
      const code = key.split(":")[1]?.slice(3);
      if (code && !queueState.capacityK6Queues[code]) codes.add(code);
    }
  } while (cursor !== "0");
  const restoredEvents: Record<string, QueueEvents> = {};
  for (const code of codes) {
    const queue = new Queue(k6QueueName(code), queueSettings);
    queue.on("error", (err) => queueLogger.error({ err, code }, "Retained K6 queue error"));
    const counts = await queue.getJobCounts(
      "active", "waiting", "delayed", "paused", "prioritized", "waiting-children"
    );
    if (Object.values(counts).every((count) => count === 0)) {
      await queue.close();
      continue;
    }
    queueState.capacityK6Queues[code] = queue;
    queueState.retiredK6At[code] = Date.now();
    const events = new QueueEvents(queue.name, { connection: buildRedisOptions({ lazyConnect: false }) });
    restoredEvents[code] = events;
    queueState.executionQueueEvents.push(events);
  }
  return restoredEvents;
}

async function reapDisabledCapacityQueues(): Promise<void> {
  for (const [code, retiredAt] of Object.entries(queueState.retiredK6At)) {
    // Allow terminal events to settle before releasing their listener.
    if (Date.now() - retiredAt < 30_000) continue;
    const queue = queueState.capacityK6Queues[code];
    if (!queue || queueState.k6Queues[code]) continue;
    try {
      const counts = await queue.getJobCounts(
        "active", "waiting", "delayed", "paused", "prioritized", "waiting-children"
      );
      if (Object.values(counts).some((count) => count > 0) || queueState.k6Queues[code]) continue;
      delete queueState.capacityK6Queues[code];
      delete queueState.retiredK6At[code];
      const events = queueState.executionQueueEvents.filter((event) => event.name === queue.name);
      queueState.executionQueueEvents = queueState.executionQueueEvents.filter((event) => event.name !== queue.name);
      await Promise.all([queue.close(), ...events.map((event) => event.close())]);
    } catch (err) {
      queueLogger.warn({ err, code }, "Disabled queue capacity cleanup failed; will retry");
    }
  }
}

const QUEUE_REFRESH_RECONCILE_MS = 15_000;

/**
 * Listen for location changes handled by another app replica.
 * Queue maps and Bull Board live in process memory, and the admin API reaches
 * only one replica. Without this subscription the dashboard alternates between
 * those replicas and the queue list flips.
 */
export function ensureQueueRefreshSubscription(): void {
  if (!queueState.refreshReconcileTimer) {
    const timer = setInterval(() => {
      ensureQueueRefreshSubscription();
      void reconcileQueuesWithLocations();
    }, QUEUE_REFRESH_RECONCILE_MS);
    timer.unref?.();
    queueState.refreshReconcileTimer = timer;
  }
  if (queueState.refreshSubscriber?.status === "end") {
    queueState.refreshSubscriber.disconnect();
    queueState.refreshSubscriber = null;
  }
  if (queueState.refreshSubscriber || queueState.refreshSubscriberStarting) return;
  queueState.refreshSubscriberStarting = true;
  void startQueueRefreshSubscription().catch((err) => {
    queueState.refreshSubscriberStarting = false;
    queueLogger.warn(
      { err },
      "Queue refresh subscription failed; will retry on the next queue access"
    );
  });
}

async function startQueueRefreshSubscription(): Promise<void> {
  const redis = await getRedisConnection();
  const subscriber = redis.duplicate();
  subscriber.on("error", (err) => {
    queueLogger.warn({ err }, "Queue refresh subscriber error");
  });
  subscriber.on("message", (_channel: string, message: string) => {
    void handleRemoteQueueRefresh(message).catch((err) => {
      queueLogger.warn({ err }, "Queue refresh after Redis notification failed");
    });
  });
  queueState.refreshSubscriber = subscriber;
  try {
    await subscriber.subscribe(QUEUE_REFRESH_CHANNEL);
  } catch (error) {
    subscriber.disconnect();
    if (queueState.refreshSubscriber === subscriber) queueState.refreshSubscriber = null;
    throw error;
  } finally {
    queueState.refreshSubscriberStarting = false;
  }
}

async function handleRemoteQueueRefresh(message: string): Promise<void> {
  let origin: string | undefined;
  try {
    const parsed = JSON.parse(message) as { origin?: unknown };
    if (typeof parsed.origin === "string") origin = parsed.origin;
  } catch {
    // Publishers that predate origin still need a refresh. This handler does
    // not publish, so applying the message cannot loop.
  }
  if (origin && origin === queueState.instanceId) return;
  await applyRemoteLocationChange();
}

async function applyRemoteLocationChange(): Promise<void> {
  invalidateLocationCache();
  await invalidateQueueMaps({ publish: false });
  try {
    const { invalidateQueueEventHub } = await import("./queue-event-hub");
    await invalidateQueueEventHub();
  } catch (err) {
    queueLogger.warn({ err }, "Queue event hub refresh after location sync failed");
  }
  try {
    const { invalidateBullBoard } = await import("./bull-board/state");
    invalidateBullBoard();
  } catch (err) {
    queueLogger.warn({ err }, "Bull Board refresh after location sync failed");
  }
}

async function reconcileQueuesWithLocations(): Promise<void> {
  if (!queueState.initPromise || queueState.refreshPromise) return;
  try {
    const codes = await getAllEnabledLocationCodes();
    const signature = locationCodesSignature(codes);
    if (queueState.locationSignature === signature) {
      await reapDisabledCapacityQueues();
      return;
    }
    queueLogger.info(
      { previous: queueState.locationSignature, next: signature },
      "Enabled locations changed; rebuilding local queues"
    );
    await applyRemoteLocationChange();
  } catch (err) {
    queueLogger.warn({ err }, "Location queue reconcile failed");
  }
}

/**
 * Close queue connections (useful for graceful shutdown).
 */
export async function closeQueue(): Promise<void> {
  await queueState.refreshPromise?.catch(() => undefined);
  // Wait for any in-flight initialization to complete before tearing down.
  // Without this, a SIGTERM during startup could leave orphaned queues/connections.
  if (queueState.initPromise) {
    try {
      await queueState.initPromise;
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
  if (queueState.cleanupIntervalRef) {
    clearInterval(queueState.cleanupIntervalRef);
    queueState.cleanupIntervalRef = null;
  }
  if (queueState.reconcileIntervalRef) {
    clearInterval(queueState.reconcileIntervalRef);
    queueState.reconcileIntervalRef = null;
  }
  if (queueState.refreshReconcileTimer) {
    clearInterval(queueState.refreshReconcileTimer);
    queueState.refreshReconcileTimer = null;
  }

  const promises = [];
  if (queueState.refreshSubscriber) {
    const subscriber = queueState.refreshSubscriber;
    queueState.refreshSubscriber = null;
    queueState.refreshSubscriberStarting = false;
    // Pub/sub has no work to drain; offline Redis commands can wait forever.
    subscriber.disconnect();
  }
  for (const queue of Object.values(queueState.playwrightQueues)) {
    promises.push(queue.close());
  }
  for (const queue of Object.values(queueState.capacityK6Queues)) {
    promises.push(queue.close());
  }
  // Close all regional monitor queues
  if (queueState.monitorExecution) {
    for (const queue of Object.values(queueState.monitorExecution)) {
      promises.push(queue.close());
    }
  }
  if (queueState.jobSchedulerQueue) promises.push(queueState.jobSchedulerQueue.close());
  if (queueState.k6JobSchedulerQueue) promises.push(queueState.k6JobSchedulerQueue.close());
  if (queueState.monitorSchedulerQueue) promises.push(queueState.monitorSchedulerQueue.close());
  if (queueState.emailTemplateQueue) promises.push(queueState.emailTemplateQueue.close());
  if (queueState.dataLifecycleCleanupQueue) promises.push(queueState.dataLifecycleCleanupQueue.close());
  if (queueState.redisClient) promises.push(queueState.redisClient.quit());

  // Close all regional monitor events
  if (queueState.monitorExecutionEvents) {
    for (const events of Object.values(queueState.monitorExecutionEvents)) {
      promises.push(events.close());
    }
  }

  for (const events of queueState.executionQueueEvents) {
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
    for (const key in queueState.playwrightQueues) delete queueState.playwrightQueues[key];
    for (const key in queueState.k6Queues) delete queueState.k6Queues[key];
    for (const key in queueState.capacityK6Queues) delete queueState.capacityK6Queues[key];
    queueState.retiredK6At = {};
    queueState.monitorExecution = null;
    queueState.jobSchedulerQueue = null;
    queueState.k6JobSchedulerQueue = null;
    queueState.monitorSchedulerQueue = null;
    queueState.emailTemplateQueue = null;
    queueState.dataLifecycleCleanupQueue = null;
    queueState.redisClient = null;
    queueState.initPromise = null;
    queueState.refreshGeneration += 1;
    queueState.refreshPromise = null;
    queueState.monitorExecutionEvents = null;
    queueState.executionQueueEvents = [];
    queueState.cleanupSetupComplete = false;
    queueState.locationSignature = null;
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

    // Determine which locations have active queues — degrade gracefully
    // when a subset of workers is offline rather than aborting entirely.
    // This matches the scheduler's behavior in monitor-scheduler.ts.
    const { enqueuedLocations, skippedLocations } =
      await partitionMonitorLocationsByAvailability(
        effectiveLocations,
        Object.keys(monitorExecutionQueue),
        monitorQueueName
      );

    // Only fail when NO locations can accept jobs
    if (enqueuedLocations.length === 0 && effectiveLocations.length > 0) {
      const available = Object.keys(monitorExecutionQueue).join(", ") || "none";
      throw new Error(
        `No active monitor workers available for any configured location(s) [${effectiveLocations.join(", ")}]. ` +
        `Available queues: [${available}]. ` +
        `Ensure workers are running in the required regions.`
      );
    }

    if (skippedLocations.length > 0) {
      queueLogger.warn(
        { monitorId: task.monitorId, skippedLocations, enqueuedLocations },
        `Monitor ${task.monitorId}: ${skippedLocations.length} location(s) skipped ` +
        `due to missing/offline workers. Proceeding with ${enqueuedLocations.length} location(s).`
      );
    }

    const executionGroupId = `${task.monitorId}-${Date.now()}-${Buffer.from(
      crypto.randomBytes(6)
    ).toString("hex")}`;

    await Promise.all(
      enqueuedLocations.map(async (location) => {
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
            expectedLocations: enqueuedLocations,
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
