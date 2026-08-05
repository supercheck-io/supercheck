/**
 * SRE Rate Limiter
 *
 * Redis-based sliding window rate limiting for expensive SRE operations.
 * Follows the same pattern as session-security.ts checkRateLimit:
 * sorted-set sliding window with ZREMRANGEBYSCORE → ZCARD → ZADD → EXPIRE.
 *
 * Fails closed on Redis unavailability so expensive SRE operations cannot run
 * unlimited when the shared limiter is unavailable.
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
  unavailable?: boolean;
};

type SreRateLimitUnavailableReason =
  | "redis_unavailable"
  | "redis_transaction_failed"
  | "redis_error";

function logSreRateLimiterUnavailable(
  level: "warn" | "error",
  data: { key: string; reason: SreRateLimitUnavailableReason; error?: unknown },
  message: string,
) {
  sreRateLimitLogger[level](
    {
      event: "sre_rate_limiter_unavailable",
      key: data.key,
      reason: data.reason,
      error: data.error,
    },
    message,
  );
}

function unavailableResult(windowMs: number): SreRateLimitResult {
  return {
    allowed: false,
    resetTime: Date.now() + windowMs,
    remaining: 0,
    unavailable: true,
  };
}

/**
 * Core sliding-window rate check.
 * Returns allowed=false if the operation count in the window has reached maxOperations.
 * Fails closed (allowed=false) on Redis errors.
 */
async function checkSreRateLimit(
  key: string,
  maxOperations: number,
  windowMs: number,
): Promise<SreRateLimitResult> {
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      logSreRateLimiterUnavailable(
        "warn",
        { key, reason: "redis_unavailable" },
        "Redis unavailable for SRE rate limiting, denying request",
      );
      return unavailableResult(windowMs);
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
      logSreRateLimiterUnavailable(
        "warn",
        { key, reason: "redis_transaction_failed" },
        "Redis transaction failed for SRE rate limiting, denying request",
      );
      return unavailableResult(windowMs);
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
        "SRE rate limit exceeded",
      );

      return { allowed: false, resetTime, remaining: 0 };
    }

    const member = `${now}:${Math.random().toString(36).slice(2)}`;
    await redis.zadd(redisKey, now, member);
    await redis.expire(redisKey, Math.ceil(windowMs / 1000) + 10);

    return { allowed: true, remaining: maxOperations - currentCount - 1 };
  } catch (error) {
    logSreRateLimiterUnavailable(
      "error",
      { key, reason: "redis_error", error },
      "SRE rate limiting error, denying request",
    );
    return unavailableResult(windowMs);
  }
}

/**
 * Rate limit connector validation.
 * Per-user, per-connector: max 5 validations per 60 seconds.
 * Prevents SSRF-like amplification through repeated validation calls.
 */
export async function checkSreConnectorValidationRateLimit(
  userId: string,
  connectorId: string,
): Promise<SreRateLimitResult> {
  return checkSreRateLimit(
    `connector-validate:${userId}:${connectorId}`,
    5,
    60 * 1000,
  );
}

/**
 * Rate limit direct connector evidence search.
 * Per-user, per-connector: max 20 searches per 60 seconds.
 * Prevents fan-out amplification through concurrent direct connector calls.
 */
export async function checkSreConnectorSearchRateLimit(
  userId: string,
  connectorId: string,
): Promise<SreRateLimitResult> {
  return checkSreRateLimit(
    `connector-search:${userId}:${connectorId}`,
    20,
    60 * 1000,
  );
}

/**
 * Rate limit evidence brief generation.
 * Per-user, per-incident: max 3 generations per 60 seconds.
 * Each generation involves native evidence collection + an LLM call.
 */
export async function checkSreEvidenceBriefRateLimit(
  userId: string,
  incidentId: string,
): Promise<SreRateLimitResult> {
  return checkSreRateLimit(
    `evidence-brief:${userId}:${incidentId}`,
    3,
    60 * 1000,
  );
}

/**
 * Rate limit full incident investigations.
 * Per-user, per-incident: max 3 starts per 5 minutes.
 */
export async function checkSreInvestigationRateLimit(
  userId: string,
  incidentId: string,
): Promise<SreRateLimitResult> {
  return checkSreRateLimit(
    `investigation:${userId}:${incidentId}`,
    3,
    5 * 60 * 1000,
  );
}

/**
 * Rate limit stored-evidence triage.
 * Per-user, per-incident: max 10 starts per 5 minutes.
 */
export async function checkSreTriageRateLimit(
  userId: string,
  incidentId: string,
): Promise<SreRateLimitResult> {
  return checkSreRateLimit(
    `triage:${userId}:${incidentId}`,
    10,
    5 * 60 * 1000,
  );
}

/**
 * Rate limit SRE chat messages.
 * Per-user: max 30 messages per 60 seconds.
 * Each message may trigger an LLM call and optional connector tool calls.
 */
export async function checkSreChatRateLimit(
  userId: string,
): Promise<SreRateLimitResult> {
  return checkSreRateLimit(`chat:${userId}`, 30, 60 * 1000);
}

/**
 * Rate limit SRE chat attachment uploads.
 * Per-user, per-incident: max 10 uploads per minute and 100 uploads per day.
 * This protects S3/storage cost and prevents attachment spam on incident records.
 */
export async function checkSreAttachmentUploadRateLimit(
  userId: string,
  incidentId: string,
): Promise<SreRateLimitResult> {
  const burst = await checkSreRateLimit(
    `attachment-upload:minute:${userId}:${incidentId}`,
    10,
    60 * 1000,
  );

  if (!burst.allowed) {
    return burst;
  }

  const daily = await checkSreRateLimit(
    `attachment-upload:day:${userId}:${incidentId}`,
    100,
    24 * 60 * 60 * 1000,
  );

  if (!daily.allowed) {
    return daily;
  }

  return {
    allowed: true,
    remaining: Math.min(burst.remaining, daily.remaining),
  };
}
