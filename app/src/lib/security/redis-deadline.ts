/** Thrown when a rate-limiter's Redis is not ready or does not answer in time. */
export class RedisUnavailableError extends Error {}

const DEADLINE_MS = 2000;

/**
 * Runs one Redis call for a fail-closed limiter. The shared client queues commands offline and retries
 * forever, so without a deadline a down Redis hangs the request instead of failing it.
 */
export async function withRedisDeadline<T>(
  redis: { status?: string } | null,
  call: () => Promise<T>,
  ms = DEADLINE_MS,
): Promise<T> {
  if (!redis || (redis.status !== undefined && redis.status !== "ready")) {
    throw new RedisUnavailableError("Redis not ready");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RedisUnavailableError("Redis timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
