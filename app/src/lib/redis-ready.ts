import type Redis from "ioredis";

const READY_WAIT_MS = 2000;

/**
 * True once the client can take commands. A client that is still connecting (a concurrent cold start) gets a
 * short wait; one that is reconnecting, closed or ended does not, because commands would sit in the offline queue.
 */
export async function waitForRedisReady(redis: Redis, timeoutMs = READY_WAIT_MS): Promise<boolean> {
  if (redis.status === "ready") return true;
  if (redis.status !== "connecting" && redis.status !== "connect" && redis.status !== "wait") return false;
  return new Promise<boolean>((resolve) => {
    const done = (ready: boolean) => {
      clearTimeout(timer);
      redis.off("ready", onReady);
      redis.off("close", onClose);
      resolve(ready);
    };
    const onReady = () => done(true);
    const onClose = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    redis.once("ready", onReady);
    redis.once("close", onClose);
  });
}
