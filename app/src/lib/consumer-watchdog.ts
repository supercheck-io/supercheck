import type { QueueEvents, Worker } from "bullmq";
import type Redis from "ioredis";
import { createLogger } from "./logger/index";

/**
 * Detects BullMQ consumers (Workers, QueueEvents) that silently stopped after a Redis or Sentinel failover.
 * BullMQ's block-timeout guard calls `disconnect()` on the blocking client while ioredis is still resolving the
 * master through unreachable Sentinels; ioredis then sets that client to `end` for good, BullMQ swallows the
 * error and the consumer never fetches again while the process stays alive. An `end` client is revived with
 * `connect()`. A command client that is `ready` but stops answering (half-open socket) is forced to reconnect.
 * A consumer still broken after DEAD_AFTER_MS cannot recover by itself: `isConsumerHealthy()` goes false and
 * `/api/health/live` fails so Kubernetes restarts the pod.
 * Mirrors worker/src/common/consumer-watchdog.service.ts (the app and worker share no package).
 */
const logger = createLogger({ module: "consumer-watchdog" }) as {
  warn: (data: unknown, msg?: string) => void;
};

type Consumer = Worker | QueueEvents | Redis;

const PROBE_INTERVAL_MS = 15_000;
const PING_TIMEOUT_MS = 5_000;
export const DEAD_AFTER_MS = 5 * 60_000;

interface WatchdogState {
  consumers: Set<Consumer>;
  brokenSince: Map<Consumer, number>;
  timer: NodeJS.Timeout | null;
  probing: boolean;
}

// globalThis: Next.js bundles the route handlers (health) and instrumentation separately.
const KEY = Symbol.for("supercheck.consumerWatchdog");
const state: WatchdogState = ((globalThis as Record<symbol, unknown>)[KEY] ??= {
  consumers: new Set(),
  brokenSince: new Map(),
  timer: null,
  probing: false,
}) as WatchdogState;

/**
 * Registers a consumer for probing (idempotent) and starts the probe timer on first use. A plain Redis client
 * (the shared one that Queues and the capacity manager use) is only PINGed, to catch a half-open socket.
 */
export function watchConsumer<T extends Consumer>(consumer: T): T {
  state.consumers.add(consumer);
  if (!state.timer) {
    state.timer = setInterval(() => void probeConsumers(), PROBE_INTERVAL_MS);
    state.timer.unref?.();
  }
  return consumer;
}

/** False once any consumer has been broken for DEAD_AFTER_MS. */
export function isConsumerHealthy(now = Date.now()): boolean {
  for (const since of state.brokenSince.values()) {
    if (now - since >= DEAD_AFTER_MS) return false;
  }
  return true;
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), PING_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function name(consumer: Consumer): string {
  return (consumer as { name?: string }).name ?? "redis";
}

/** "ok" | "broken" | "reconnecting" (ioredis is working on it; the clock stays where it is). */
async function check(consumer: Consumer): Promise<"ok" | "broken" | "reconnecting"> {
  if ("status" in consumer) return pingClient(consumer as Redis, "shared Redis client");
  const isWorker = "blockingConnection" in consumer;
  // Never PING the blocking client: the PING would queue behind the blocked BZPOPMIN/XREAD.
  const blocking = (await withTimeout(
    (isWorker
      ? (consumer as unknown as { blockingConnection: { client: Promise<Redis> } }).blockingConnection.client
      : consumer.client) as Promise<Redis>,
  )) as Redis;
  if (blocking.status === "end") {
    logger.warn({ queue: name(consumer) }, "Blocking Redis connection ended; reconnecting");
    blocking.connect().catch(() => undefined);
    return "broken";
  }
  if (!isWorker) return blocking.status === "ready" ? "ok" : "reconnecting";

  const worker = consumer as Worker;
  const client = (await withTimeout(worker.client)) as unknown as Redis;
  if (client.status === "end") {
    client.connect().catch(() => undefined);
    return "broken";
  }
  if (worker.isPaused()) return "ok";
  if (!worker.isRunning()) return "broken";
  return pingClient(client, name(consumer));
}

async function pingClient(client: Redis, label: string): Promise<"ok" | "broken" | "reconnecting"> {
  if (client.status !== "ready") return "reconnecting";
  try {
    await withTimeout(client.ping());
    return "ok";
  } catch (error) {
    // A command that neither fails nor answers on a "ready" client means a half-open socket.
    logger.warn({ queue: label, err: error }, "Redis PING failed; forcing reconnect");
    client.disconnect(true);
    return "broken";
  }
}

export async function probeConsumers(now = Date.now()): Promise<void> {
  if (state.probing) return;
  state.probing = true;
  try {
    await Promise.all(
      [...state.consumers].map(async (consumer) => {
        // An ended shared client is replaced by getRedisConnection(); the old one is no longer watched.
        if ("status" in consumer ? consumer.status === "end" : consumer.closing) {
          state.consumers.delete(consumer);
          state.brokenSince.delete(consumer);
          return;
        }
        let result: Awaited<ReturnType<typeof check>>;
        try {
          result = await check(consumer);
        } catch {
          result = "broken";
        }
        if (result === "ok") state.brokenSince.delete(consumer);
        else if (result === "broken" && !state.brokenSince.has(consumer)) {
          state.brokenSince.set(consumer, now);
          logger.warn({ queue: name(consumer) }, "BullMQ consumer unhealthy");
        }
      }),
    );
  } finally {
    state.probing = false;
  }
}

/** Test helper. */
export function resetConsumerWatchdogForTests(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.consumers.clear();
  state.brokenSince.clear();
  state.probing = false;
}
