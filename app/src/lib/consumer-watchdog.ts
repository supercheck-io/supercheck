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
/** A busy Redis can stall a PING for several seconds; only this many timed-out probes in a row mean a dead socket. */
const PING_MISSES_BEFORE_KICK = 3;

class ProbeTimeoutError extends Error {}
type Result = "ok" | "broken" | "reconnecting";
// Consecutive timed-out PINGs per client; any reply (even an error) or leaving "ready" resets it.
const pingMisses = new WeakMap<Redis, number>();

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
      timer = setTimeout(() => reject(new ProbeTimeoutError("timed out")), PING_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function name(consumer: Consumer): string {
  return (consumer as { name?: string }).name ?? "redis";
}

/** "ok" | "broken" | "reconnecting" (ioredis is working on it, so Redis is not known to be reachable). */
async function check(consumer: Consumer, pings: Map<Redis, Promise<Result>>): Promise<Result> {
  if ("status" in consumer) return pingOnce(consumer as Redis, "shared Redis client", pings);
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
  if (!isWorker) {
    if (blocking.status !== "ready") return "reconnecting";
    return (consumer as unknown as { running?: boolean }).running === false ? "broken" : "ok";
  }

  const worker = consumer as Worker;
  const client = (await withTimeout(worker.client)) as unknown as Redis;
  if (client.status === "end") {
    client.connect().catch(() => undefined);
    return "broken";
  }
  if (worker.isPaused()) return "ok";
  if (!worker.isRunning()) return "broken";
  return pingOnce(client, name(consumer), pings);
}

// One PING per client per probe: a client shared by several consumers must not count several misses.
function pingOnce(client: Redis, label: string, pings: Map<Redis, Promise<Result>>): Promise<Result> {
  let result = pings.get(client);
  if (!result) pings.set(client, (result = pingClient(client, label)));
  return result;
}

async function pingClient(client: Redis, label: string): Promise<Result> {
  if (client.status !== "ready") {
    pingMisses.delete(client);
    return "reconnecting";
  }
  try {
    await withTimeout(client.ping());
  } catch (error) {
    // Any reply, even an error such as LOADING or READONLY, proves the socket is alive.
    if (!(error instanceof ProbeTimeoutError)) {
      pingMisses.delete(client);
      return "ok";
    }
    // Only while still ready: disconnect() on a client already resolving the master can end it for good.
    if (client.status !== "ready") {
      pingMisses.delete(client);
      return "reconnecting";
    }
    const misses = (pingMisses.get(client) ?? 0) + 1;
    if (misses < PING_MISSES_BEFORE_KICK) {
      pingMisses.set(client, misses);
      return "broken";
    }
    // Several silent probes in a row on a "ready" client mean a half-open socket.
    pingMisses.delete(client);
    logger.warn({ queue: label, err: error }, "Redis PING timed out repeatedly; forcing reconnect");
    client.disconnect(true);
    return "broken";
  }
  pingMisses.delete(client);
  return "ok";
}

export async function probeConsumers(now = Date.now()): Promise<void> {
  if (state.probing) return;
  state.probing = true;
  try {
    const pings = new Map<Redis, Promise<Result>>();
    await Promise.all(
      [...state.consumers].map(async (consumer) => {
        // An ended shared client is replaced by getRedisConnection(); the old one is no longer watched.
        if ("status" in consumer ? consumer.status === "end" : consumer.closing) {
          state.consumers.delete(consumer);
          state.brokenSince.delete(consumer);
          return;
        }
        let result: Result;
        try {
          result = await check(consumer, pings);
        } catch {
          // BullMQ's client promise is still pending: it is waiting for Redis to come up.
          result = "reconnecting";
        }
        // Redis is not shown reachable while reconnecting, so a long outage never counts as a dead consumer.
        if (result !== "broken") state.brokenSince.delete(consumer);
        else if (!state.brokenSince.has(consumer)) {
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
