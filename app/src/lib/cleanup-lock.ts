import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

// Extend or delete the key only while it still holds this owner's token.
const RENEW_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export interface OwnedLock {
  /** Aborted once the lock is lost (renewal found another token, the key expired, or Redis failed). */
  signal: AbortSignal;
  /** Stops renewal and deletes the key only if this owner still holds it. Never throws. */
  release(): Promise<void>;
}

/**
 * Token-owned Redis lock: `SET NX PX` with a random token, renewed on a timer while the holder runs, released by
 * compare-and-delete. A holder that loses the lock sees `signal.aborted` and stops at its next safe point, so two
 * runs never keep working under the same key. After `maxHoldMs` renewal stops, so a hung holder cannot keep the key
 * forever. Returns null when another owner holds the key.
 */
export async function acquireOwnedLock(
  redis: Redis,
  key: string,
  { ttlMs, renewEveryMs, maxHoldMs = Number.POSITIVE_INFINITY }: { ttlMs: number; renewEveryMs: number; maxHoldMs?: number },
): Promise<OwnedLock | null> {
  const token = randomUUID();
  if ((await redis.set(key, token, "PX", ttlMs, "NX")) !== "OK") return null;

  const controller = new AbortController();
  const lose = (reason: string) => {
    clearInterval(timer);
    if (controller.signal.aborted) return;
    console.error(`[DATA_LIFECYCLE] Lost lock ${key}: ${reason}; stopping at the next batch boundary`);
    controller.abort(new Error(reason));
  };
  const acquiredAt = Date.now();
  const timer = setInterval(() => {
    // A holder stuck in one call past its budget stops renewing: the key lapses after its TTL.
    if (Date.now() - acquiredAt >= maxHoldMs) return lose("held past its maximum time");
    redis.eval(RENEW_SCRIPT, 1, key, token, String(ttlMs)).then(
      (renewed) => {
        if (Number(renewed) !== 1) lose("held by another owner or expired");
      },
      (error: unknown) => lose(`renewal failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }, renewEveryMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    async release() {
      clearInterval(timer);
      try {
        await redis.eval(RELEASE_SCRIPT, 1, key, token);
      } catch (error) {
        // The key expires by its TTL.
        console.error(`[DATA_LIFECYCLE] Failed to release lock ${key}:`, error);
      }
    },
  };
}
