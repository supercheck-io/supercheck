import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

// Extend or delete the key only while it still holds this owner's token.
const RENEW_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_TIMEOUT_MS = 5_000;
const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export interface OwnedLock {
  /** The key and this owner's token, so other writes can be fenced on still holding the lock. */
  key: string;
  token: string;
  /** Aborted once the lock is lost (another token, the key expired) or renewals failed long enough that it may lapse. */
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
  let released = false;
  const lose = (reason: string) => {
    clearInterval(timer);
    // A renewal that answers after release() is not a lost lock.
    if (released || controller.signal.aborted) return;
    console.error(`[DATA_LIFECYCLE] Lost lock ${key}: ${reason}; stopping at the next batch boundary`);
    controller.abort(new Error(reason));
  };
  const acquiredAt = Date.now();
  let confirmedAt = acquiredAt;
  // Without a confirmed renewal, the key may lapse before the next attempt: stop before that can happen.
  const mayLapse = () => Date.now() - confirmedAt + renewEveryMs >= ttlMs;
  const timer = setInterval(() => {
    // A holder stuck in one call past its budget stops renewing: the key lapses after its TTL.
    if (Date.now() - acquiredAt >= maxHoldMs) return lose("held past its maximum time");
    if (mayLapse()) return lose("no confirmed renewal within its TTL");
    redis.eval(RENEW_SCRIPT, 1, key, token, String(ttlMs)).then(
      (renewed) => {
        if (Number(renewed) !== 1) lose("held by another owner or expired");
        else confirmedAt = Date.now();
      },
      // One failed call is tolerated; the TTL check above stops the run before the key can lapse.
      (error: unknown) => {
        console.warn(`[DATA_LIFECYCLE] Lock ${key} renewal failed, retrying: ${error instanceof Error ? error.message : String(error)}`);
        if (mayLapse()) lose("renewal failed and the TTL may lapse");
      },
    );
  }, renewEveryMs);
  timer.unref?.();

  return {
    key,
    token,
    signal: controller.signal,
    async release() {
      released = true;
      clearInterval(timer);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        // Bounded: a Redis that does not answer must not hold the worker; the key then lapses by its TTL.
        await Promise.race([
          redis.eval(RELEASE_SCRIPT, 1, key, token),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("release timed out")), RELEASE_TIMEOUT_MS);
          }),
        ]);
      } catch (error) {
        // The key expires by its TTL.
        console.error(`[DATA_LIFECYCLE] Failed to release lock ${key}:`, error);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
