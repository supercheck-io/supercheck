import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

// Extend or delete the key only while it still holds this owner's token.
const RENEW_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_TIMEOUT_MS = 5_000;
const ACQUIRE_TIMEOUT_MS = 10_000;
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
 * forever. Returns null when another owner holds the key; throws when Redis does not answer within 10 s (a queued
 * SET is then undone) or answers too late for the lease to be safe. Elapsed time uses a monotonic clock (`now`), so a
 * wall-clock step backwards cannot extend the lease past the Redis TTL.
 */
export async function acquireOwnedLock(
  redis: Redis,
  key: string,
  {
    ttlMs,
    renewEveryMs,
    maxHoldMs = Number.POSITIVE_INFINITY,
    now = () => performance.now(),
  }: { ttlMs: number; renewEveryMs: number; maxHoldMs?: number; now?: () => number },
): Promise<OwnedLock | null> {
  const token = randomUUID();
  // The lease is counted from before the command was sent: Redis may have started it any time after that.
  const sentAt = now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let acquired: unknown;
  try {
    acquired = await Promise.race([
      redis.set(key, token, "PX", ttlMs, "NX"),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`lock ${key} acquisition timed out`)), ACQUIRE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    // A SET still queued on the client may run later: a compare-and-delete queued after it removes that lease.
    void redis.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (acquired !== "OK") return null;
  if (now() - sentAt + renewEveryMs >= ttlMs) {
    // The reply came so late that the lease could lapse before the first renewal: do not run on it.
    void redis.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
    throw new Error(`lock ${key} acquired too late to be safe`);
  }

  const controller = new AbortController();
  let released = false;
  const lose = (reason: string) => {
    clearInterval(timer);
    // A renewal that answers after release() is not a lost lock.
    if (released || controller.signal.aborted) return;
    console.error(`[DATA_LIFECYCLE] Lost lock ${key}: ${reason}; stopping at the next batch boundary`);
    controller.abort(new Error(reason));
  };
  const acquiredAt = sentAt;
  let confirmedAt = sentAt;
  // Without a confirmed renewal, the key may lapse before the next attempt: stop before that can happen.
  const mayLapse = () => now() - confirmedAt + renewEveryMs >= ttlMs;
  const timer = setInterval(() => {
    // A holder stuck in one call past its budget stops renewing: the key lapses after its TTL.
    if (now() - acquiredAt >= maxHoldMs) return lose("held past its maximum time");
    if (mayLapse()) return lose("no confirmed renewal within its TTL");
    const renewSentAt = now();
    redis.eval(RENEW_SCRIPT, 1, key, token, String(ttlMs)).then(
      (renewed) => {
        if (Number(renewed) !== 1) lose("held by another owner or expired");
        // From the send time: the new TTL started no earlier than that.
        else confirmedAt = renewSentAt;
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
