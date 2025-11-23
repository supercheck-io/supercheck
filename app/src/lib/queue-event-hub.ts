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

  constructor() {
    super();
    this.setMaxListeners(0);
    this.readyPromise = this.initialize().catch((error) => {
      eventHubLogger.error({ err: error }, "Fatal error during initialization");
      throw error;
    });
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
      
      // Add playwright GLOBAL queue
      sources.push({
        category: "test", // Playwright queues handle both test and job execution
        queueName: "playwright-GLOBAL",
        queue: playwrightQueues["GLOBAL"],
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

      eventHubLogger.info("Successfully initialized with BullMQ event listeners");
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

        eventHubLogger.info({
          queueJobId,
          event,
          hasReturnvalue: !!returnValue,
          returnvalueType: typeof returnValue,
          hasSuccessField,
          successValue: hasSuccessField ? (returnValue as { success?: unknown }).success : undefined,
        }, "Processing completed event");

        status =
          hasSuccessField
            ? (returnValue as { success?: unknown }).success === true
              ? "passed"
              : "failed"
            : "failed"; // Default to failed if no clear success indication

        eventHubLogger.info({
          queueJobId,
          mappedStatus: status,
        }, `Mapped completed event to status: ${status}`);
        break;
      case "failed":
      case "stalled":
        status = event === "failed" ? "failed" : "error";
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
