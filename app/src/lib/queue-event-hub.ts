import { EventEmitter } from "node:events";
import { Queue, QueueEvents } from "bullmq";
import { eq } from "drizzle-orm";
import {
  getQueues,
  REGIONS,
  MONITOR_REGIONS,
} from "@/lib/queue";
import { db } from "@/utils/db";
import { runs } from "@/db/schema";
import { createLogger } from "./logger/index";

// UUID validation regex - defined once to avoid duplication
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Create queue event hub logger
const eventHubLogger = createLogger({ module: 'queue-event-hub' }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

type QueueCategory = "job" | "test" | "monitor";

export type NormalizedQueueEvent = {
  category: QueueCategory;
  queue: string;
  event: "waiting" | "active" | "completed" | "failed" | "stalled";
  status: "running" | "passed" | "failed" | "error";
  queueJobId: string;
  entityId?: string;
  trigger?: string;
  timestamp: string;
  returnValue?: unknown;
  failedReason?: string;
};

type QueueEventName = NormalizedQueueEvent["event"];

interface QueueEventSource {
  category: QueueCategory;
  queueName: string;
  queue: Queue;
}

class QueueEventHub extends EventEmitter {
  private initialized = false;
  private readyPromise: Promise<void> | null = null;
  private queueEvents: QueueEvents[] = [];
  private closing = false;
  private runMetaCache = new Map<string, { entityId?: string; trigger?: string }>();
  private static processListenersAttached = false;

  constructor() {
    super();
    this.setMaxListeners(0);
    this.readyPromise = this.initialize().catch((error) => {
      eventHubLogger.error({ err: error }, "Fatal error during initialization");
      throw error;
    });

    // Only attach process listeners once per application lifecycle
    // This prevents MaxListenersExceededWarning in development with hot reloading
    if (!QueueEventHub.processListenersAttached) {
      QueueEventHub.processListenersAttached = true;

      process.once("exit", () => {
        void this.closeAll();
      });
      process.once("SIGINT", () => {
        void this.closeAll();
      });
      process.once("SIGTERM", () => {
        void this.closeAll();
      });
    }
  }

  /**
   * Ensures queue event listeners are attached once.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    try {
      const { playwrightQueues, k6Queues, monitorExecutionQueue } = await getQueues();

      const sources: QueueEventSource[] = [];
      
      // Add playwright global queue
      sources.push({
        category: "test", // Playwright queues handle both test and job execution
        queueName: "playwright-global",
        queue: playwrightQueues["global"],
      });
      
      // Add k6 queues for all regions
      for (const region of REGIONS) {
        sources.push({
          category: "job", // K6 queues are typically for jobs
          queueName: `k6-${region}`,
          queue: k6Queues[region],
        });
      }

      // Add monitor queues for all regions
      for (const region of MONITOR_REGIONS) {
        sources.push({
          category: "monitor",
          queueName: `monitor-${region}`,
          queue: monitorExecutionQueue[region],
        });
      }

      await Promise.all(
        sources.map((source) => this.attachQueueEvents(source).catch((error) => {
          eventHubLogger.error({ err: error },
            `Failed to attach QueueEvents for ${source.queueName}`);
          // Don't throw - allow other queues to initialize
        }))
      );

      // Initialization complete - no info log needed (reduces log pollution)
    } catch (error) {
      eventHubLogger.error({ err: error }, "Failed to initialize");
      throw error;
    }
  }

  private async attachQueueEvents(source: QueueEventSource): Promise<void> {
    // Create a new dedicated Redis connection for QueueEvents
    // BullMQ recommends using separate connections for Queue and QueueEvents
    const Redis = (await import('ioredis')).default;

    const connection = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false, // Connect immediately
    });

    // Log connection errors for debugging
    connection.on('error', (error) => {
      eventHubLogger.error({ err: error },
        `Redis connection error for ${source.queueName}`);
    });

    const events = new QueueEvents(source.queueName, { connection });
    this.queueEvents.push(events);

    events.on("error", (error) => {
      eventHubLogger.error({ err: error }, 
        `QueueEvents error for ${source.queueName}:`,
      );
    });

    const handle = async (
      event: QueueEventName,
      payload: Record<string, unknown>
    ) => {
      const normalized = await this.normalizeEvent(
        source.category,
        source.queueName,
        event,
        payload
      );
      if (normalized) {
        this.emit("event", normalized);
      }
    };

    events.on("waiting", (payload) => void handle("waiting", payload));
    events.on("active", (payload) => void handle("active", payload));
    events.on("completed", (payload) => void handle("completed", payload));
    events.on("failed", (payload) => void handle("failed", payload));
    events.on("stalled", (payload) => void handle("stalled", payload));

    await events.waitUntilReady();
  }

  private async closeAll(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;

    await Promise.all(
      this.queueEvents.map(async (events) => {
        try {
          await events.close();
        } catch (error) {
          eventHubLogger.error({ err: error }, 
            "Failed to close QueueEvents:",
          );
        }
      })
    );
  }

  private async normalizeEvent(
    category: QueueCategory,
    queueName: string,
    event: QueueEventName,
    payload: Record<string, unknown>
  ): Promise<NormalizedQueueEvent | null> {
    const queueJobIdRaw = payload?.jobId;
    if (!queueJobIdRaw) {
      return null;
    }

    const queueJobId = String(queueJobIdRaw);
    let entityId: string | undefined;
    let trigger: string | undefined;

    const cached = this.runMetaCache.get(queueJobId);
    if (cached) {
      entityId = cached.entityId;
      trigger = cached.trigger;
    } else {
      try {
        // Check if this is a composite monitor ID (uuid:group:location)
        // Format: monitorId:executionGroupId:location
        const isCompositeMonitorId = category === 'monitor' && queueJobId.includes(':');
        
        if (isCompositeMonitorId) {
          const parts = queueJobId.split(':');
          // First part is monitorId (UUID)
          const monitorId = parts[0];
          
          if (UUID_REGEX.test(monitorId)) {
            entityId = monitorId;
            trigger = 'schedule'; // Default trigger for monitors
            this.runMetaCache.set(queueJobId, { entityId, trigger });
          } else {
            // Log warning for invalid composite ID format
            eventHubLogger.warn(
              { queueJobId, monitorId, category },
              'Invalid monitor composite ID format - monitorId is not a valid UUID'
            );
            // Cache to avoid repeated warnings
            this.runMetaCache.set(queueJobId, { entityId: undefined, trigger: undefined });
          }
        } 
        // Only query runs table if queueJobId is a valid UUID
        else {
          if (UUID_REGEX.test(queueJobId)) {
            const run = await db.query.runs.findFirst({
              where: eq(runs.id, queueJobId),
            });

            if (run) {
              trigger = run.trigger ?? undefined;

              // Determine entityId based on run type
              if (run.jobId) {
                // This is a job run - use the jobId
                entityId = run.jobId;
              } else if (
                typeof run.metadata === "object" &&
                run.metadata !== null &&
                "testId" in run.metadata &&
                typeof (run.metadata as Record<string, unknown>).testId === "string"
              ) {
                // Test with testId in metadata
                entityId = (run.metadata as Record<string, unknown>).testId as string;
              } else if (category === "test") {
                // For single test executions, the runId IS the testId
                entityId = queueJobId;
              }

              this.runMetaCache.set(queueJobId, { entityId, trigger });
            }
          }
        }
      } catch (error) {
        eventHubLogger.warn({ err: error },
          `Failed to load run metadata for ${queueJobId}`);
      }
    }

    let status: NormalizedQueueEvent["status"];

    switch (event) {
      case "waiting":
      case "active":
        status = "running";
        break;
      case "completed":
        // IMPORTANT: Only mark as "passed" if explicitly successful
        // Default to "failed" for safety - failed tests should never be treated as passed

        // Log the actual payload for debugging
        const returnValue = payload?.returnvalue;
        const hasSuccessField =
          returnValue !== null &&
          typeof returnValue === "object" &&
          "success" in returnValue;

        // OPTIMIZED: Removed debug logging to reduce log pollution
        // Only log errors from queue-event-hub

        // Check if this is a cancellation (error field contains cancellation message)
        // Note: Cancellations are now treated as "error" status, not a separate status
        const errorField = returnValue !== null && typeof returnValue === "object" && "error" in returnValue
          ? (returnValue as { error?: string }).error
          : undefined;
        const isCancellation = errorField && (
          errorField.toLowerCase().includes("cancellation") ||
          errorField.toLowerCase().includes("cancelled")
        );

        if (isCancellation) {
          // Cancellations are treated as errors (infrastructure-level failures)
          status = "error";
        } else if (hasSuccessField) {
          // Direct success field - use it
          status = (returnValue as { success?: unknown }).success === true ? "passed" : "failed";
        } else if (category === "monitor" && Array.isArray(returnValue) && returnValue.length > 0) {
          // Monitor results are arrays - check if ALL results succeeded
          const allSucceeded = returnValue.every((result) => {
            if (typeof result === "object" && result !== null) {
              // Check for explicit success field
              if ("success" in result) {
                return result.success === true;
              }
              // Check for error field (indicates failure)
              if ("error" in result && result.error) {
                return false;
              }
              // Check for status field
              if ("status" in result) {
                return result.status === "passed" || result.status === "success";
              }
            }
            // If we can't determine, assume success (backward compatibility)
            return true;
          });
          status = allSucceeded ? "passed" : "failed";
        } else if (Array.isArray(returnValue) && returnValue.length > 0) {
          // Non-monitor arrays - default to failed for safety
          status = "failed";
        } else {
          status = "failed"; // Default to failed if no clear success indication
        }

        // OPTIMIZED: Removed info logging to reduce log pollution
        break;
      case "failed":
        status = "failed";
        break;
      case "stalled":
        // Stalled jobs are automatically retried by BullMQ (up to maxStalledCount).
        // Mapping to 'error' causes UI flicker since the job transitions back to 'active'.
        // Keep status as 'running' to reflect the actual lifecycle.
        status = "running";
        break;
      default:
        status = "running";
        break;
    }

    return {
      category,
      queue: queueName,
      event,
      status,
      queueJobId,
      entityId,
      trigger,
      timestamp: new Date().toISOString(),
      returnValue: payload?.returnvalue,
      failedReason: (payload?.failedReason ?? payload?.reason) as string | undefined,
    };
  }

  async ready(): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise;
    }
  }

  subscribe(listener: (event: NormalizedQueueEvent) => void): () => void {
    this.on("event", listener);
    return () => {
      this.off("event", listener);
    };
  }
}

declare global {
  var __SUPER_CHECK_QUEUE_EVENT_HUB__: QueueEventHub | undefined;
}

export function getQueueEventHub(): QueueEventHub {
  if (!globalThis.__SUPER_CHECK_QUEUE_EVENT_HUB__) {
    globalThis.__SUPER_CHECK_QUEUE_EVENT_HUB__ = new QueueEventHub();
  }
  return globalThis.__SUPER_CHECK_QUEUE_EVENT_HUB__;
}
