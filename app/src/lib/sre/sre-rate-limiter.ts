/**
 * SRE Rate Limiter
 *
 * Redis-based sliding window rate limiting for expensive SRE operations.
 * Follows the same pattern as session-security.ts checkRateLimit:
 * sorted-set sliding window with ZREMRANGEBYSCORE → ZCARD → ZADD → EXPIRE.
 *
 * Fails open on Redis unavailability to avoid blocking incident investigation.
 * All keys use the `supercheck:sre:ratelimit:` prefix for consistency.
 */

import { getRedisConnection } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";

const sreRateLimitLogger = createLogger({ module: "sre-rate-limit" }) as {
  debug: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

const RATE_LIMIT_KEY_PREFIX = "supercheck:sre:ratelimit";

export type SreRateLimitResult = {
  allowed: boolean;
  resetTime?: number;
  remaining: number;
};

/**
 * Core sliding-window rate check.
 * Returns allowed=false if the operation count in the window has reached maxOperations.
 * Fails open (allowed=true) on Redis errors.
 */
async function checkSreRateLimit(
  key: string,
  maxOperations: number,
  windowMs: number
): Promise<SreRateLimitResult> {
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      sreRateLimitLogger.warn({ key }, "Redis unavailable for SRE rate limiting, allowing request");
      return { allowed: true, remaining: maxOperations };
    }

    const redisKey = `${RATE_LIMIT_KEY_PREFIX}:${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    const multi = redis.multi();
    multi.zremrangebyscore(redisKey, 0, windowStart);
    multi.zcard(redisKey);
    multi.zrange(redisKey, 0, 0, "WITHSCORES");

    const results = await multi.exec();

    if (!results) {
      sreRateLimitLogger.warn({ key }, "Redis transaction failed, allowing request");
      return { allowed: true, remaining: maxOperations };
    }

    const currentCount = (results[1]?.[1] as number) ?? 0;

    if (currentCount >= maxOperations) {
      const oldestEntry = results[2]?.[1] as string[] | undefined;
      let resetTime = now + windowMs;

      if (oldestEntry && oldestEntry.length >= 2) {
        const oldestTimestamp = parseInt(oldestEntry[1], 10);
        resetTime = oldestTimestamp + windowMs;
      }

      sreRateLimitLogger.debug(
        { key, count: currentCount, limit: maxOperations },
        "SRE rate limit exceeded"
      );

      return { allowed: false, resetTime, remaining: 0 };
    }

    const member = `${now}:${Math.random().toString(36).slice(2)}`;
    await redis.zadd(redisKey, now, member);
    await redis.expire(redisKey, Math.ceil(windowMs / 1000) + 10);

    return { allowed: true, remaining: maxOperations - currentCount - 1 };
  } catch (error) {
    sreRateLimitLogger.error({ error, key }, "SRE rate limiting error, allowing request");
    return { allowed: true, remaining: maxOperations };
  }
}

/**
 * Rate limit connector validation.
 * Per-user, per-connector: max 5 validations per 60 seconds.
 * Prevents SSRF-like amplification through repeated validation calls.
 */
export async function checkSreConnectorValidationRateLimit(
  userId: string,
  connectorId: string
): Promise<SreRateLimitResult> {
  return checkSreRateLimit(
    `connector-validate:${userId}:${connectorId}`,
    5,
    60 * 1000
  );
}

/**
 * Rate limit direct connector evidence search.
 * Per-user, per-connector: max 20 searches per 60 seconds.
 * Prevents fan-out amplification through concurrent direct connector calls.
 */
export async function checkSreConnectorSearchRateLimit(
  userId: string,
  connectorId: string
): Promise<SreRateLimitResult> {
  return checkSreRateLimit(
    `connector-search:${userId}:${connectorId}`,
    20,
    60 * 1000
  );
}

/**
 * Rate limit evidence brief generation.
 * Per-user, per-incident: max 3 generations per 60 seconds.
 * Each generation involves native evidence collection + an LLM call.
 */
export async function checkSreEvidenceBriefRateLimit(
  userId: string,
  incidentId: string
): Promise<SreRateLimitResult> {
  return checkSreRateLimit(
    `evidence-brief:${userId}:${incidentId}`,
    3,
    60 * 1000
  );
}

/**
 * Rate limit SRE chat messages.
 * Per-user: max 30 messages per 60 seconds.
 * Each message may trigger an LLM call and optional connector tool calls.
 */
export async function checkSreChatRateLimit(
  userId: string
): Promise<SreRateLimitResult> {
  return checkSreRateLimit(
    `chat:${userId}`,
    30,
    60 * 1000
  );
}

/**
 * Rate limit SRE chat attachment uploads.
 * Per-user, per-incident: max 10 uploads per minute and 100 uploads per day.
 * This protects S3/storage cost and prevents attachment spam on incident records.
 */
export async function checkSreAttachmentUploadRateLimit(
  userId: string,
  incidentId: string
): Promise<SreRateLimitResult> {
  const burst = await checkSreRateLimit(
    `attachment-upload:minute:${userId}:${incidentId}`,
    10,
    60 * 1000
  );

  if (!burst.allowed) {
    return burst;
  }

  const daily = await checkSreRateLimit(
    `attachment-upload:day:${userId}:${incidentId}`,
    100,
    24 * 60 * 60 * 1000
  );

  if (!daily.allowed) {
    return daily;
  }

  return { allowed: true, remaining: Math.min(burst.remaining, daily.remaining) };
}
