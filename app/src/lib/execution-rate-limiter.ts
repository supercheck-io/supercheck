import { getRedisConnection } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";
import { randomUUID } from "crypto";

const logger = createLogger({ module: "execution-rate-limiter" }) as {
  error: (data: unknown, msg?: string) => void;
};

const WINDOW_SECONDS = 60;

function positiveLimit(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ExecutionRateLimitResult {
  allowed: boolean;
  retryAfter: number;
  reason?: "rate_limited" | "unavailable";
}

/**
 * Applies both per-user and per-organization limits to authenticated manual
 * executions. A single Lua operation makes the decision consistent across app
 * replicas. Redis failures reject the request because an unavailable limiter
 * must not silently remove an abuse/cost control.
 */
export async function checkExecutionRateLimit(
  userId: string,
  organizationId: string,
): Promise<ExecutionRateLimitResult> {
  const userLimit = positiveLimit(process.env.EXECUTION_RATE_LIMIT_PER_USER, 30);
  const organizationLimit = positiveLimit(
    process.env.EXECUTION_RATE_LIMIT_PER_ORGANIZATION,
    120,
  );
  const now = Date.now();
  const windowMs = WINDOW_SECONDS * 1000;
  const windowStart = now - windowMs;
  const userKey = `supercheck:execution-rate:user:${userId}`;
  const organizationKey = `supercheck:execution-rate:org:${organizationId}`;

  const script = `
    local windowStart = tonumber(ARGV[1])
    local now = tonumber(ARGV[2])
    local userLimit = tonumber(ARGV[3])
    local organizationLimit = tonumber(ARGV[4])
    local ttl = tonumber(ARGV[5])
    local entryId = ARGV[6]

    redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, windowStart)
    redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, windowStart)
    local userCount = redis.call('ZCARD', KEYS[1])
    local organizationCount = redis.call('ZCARD', KEYS[2])

    if userCount >= userLimit or organizationCount >= organizationLimit then
      local retryAt = now
      if userCount >= userLimit then
        local userOldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
        retryAt = math.max(retryAt, tonumber(userOldest[2] or now) + tonumber(ARGV[7]))
      end
      if organizationCount >= organizationLimit then
        local organizationOldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
        retryAt = math.max(retryAt, tonumber(organizationOldest[2] or now) + tonumber(ARGV[7]))
      end
      return {0, retryAt}
    end

    redis.call('ZADD', KEYS[1], now, entryId)
    redis.call('ZADD', KEYS[2], now, entryId)
    redis.call('EXPIRE', KEYS[1], ttl)
    redis.call('EXPIRE', KEYS[2], ttl)
    return {1, 0}
  `;

  try {
    const redis = await getRedisConnection();
    const result = (await redis.eval(
      script,
      2,
      userKey,
      organizationKey,
      windowStart,
      now,
      userLimit,
      organizationLimit,
      WINDOW_SECONDS + 5,
      `${now}:${randomUUID()}`,
      windowMs,
    )) as [number, number];
    const [allowed, retryAt] = result;
    return {
      allowed: allowed === 1,
      retryAfter:
        allowed === 1 ? 0 : Math.max(1, Math.ceil((retryAt - now) / 1000)),
      reason: allowed === 1 ? undefined : "rate_limited",
    };
  } catch (error) {
    logger.error(
      { error, userId, organizationId },
      "Execution rate limiter unavailable",
    );
    return {
      allowed: false,
      retryAfter: WINDOW_SECONDS,
      reason: "unavailable",
    };
  }
}
