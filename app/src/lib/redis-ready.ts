import type Redis from "ioredis";

const READY_WAIT_MS = 2000;

// One shared wait per client, so a burst of requests during a blip adds one listener, not one each.
const pending = new WeakMap<Redis, Promise<boolean>>();

/**
 * True once the client can take commands. A client that is connecting or reconnecting (a cold start, or a
 * Sentinel failover that usually takes 1-3 s) gets a short bounded wait; only an ended client (closed for good,
 * since our retryStrategy always retries) fails at once. Callers never send a command before this is true, so
 * nothing piles up in ioredis's offline queue.
 */
export async function waitForRedisReady(redis: Redis, timeoutMs = READY_WAIT_MS): Promise<boolean> {
  if (redis.status === "ready") return true;
  if (redis.status === "end") return false;
  let wait = pending.get(redis);
  if (!wait) {
    wait = new Promise<boolean>((resolve) => {
      const done = (ready: boolean) => {
        clearTimeout(timer);
        redis.off("ready", onReady);
        redis.off("end", onEnd);
        pending.delete(redis);
        resolve(ready);
      };
      // Not "close": ioredis emits it on every failed reconnect attempt, before retrying.
      const onReady = () => done(true);
      const onEnd = () => done(false);
      const timer = setTimeout(() => done(false), timeoutMs);
      redis.once("ready", onReady);
      redis.once("end", onEnd);
    });
    pending.set(redis, wait);
  }
  return wait;
}
