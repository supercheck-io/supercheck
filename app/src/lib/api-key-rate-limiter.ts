/**
 * API Key Rate Limiter Service
 *
 * Redis-based sliding window rate limiting for API key requests.
 * Enforces rate limits defined in the apikey table:
 * - rateLimitEnabled: Whether rate limiting is active
 * - rateLimitTimeWindow: Window in seconds (default: 60)
 * - rateLimitMax: Maximum requests per window (default: 100)
 *
 * This service implements:
 * - Sliding window rate limiting algorithm
 * - Per-API-key limits
 * - Fail-closed behavior on Redis errors
 * - Detailed rate limit headers for responses
 */

import { getRedisConnection } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";
import { randomUUID } from "crypto";

const logger = createLogger({ module: "api-key-rate-limiter" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

// Redis key prefix for API key rate limiting
const KEY_PREFIX = "supercheck:apikey:ratelimit";

/**
 * Rate limit configuration for an API key
 */
export interface ApiKeyRateLimitConfig {
  enabled: boolean;
  timeWindow: number; // Window in seconds
  maxRequests: number; // Max requests per window
}

/**
 * Result of rate limit check
 */
export interface ApiKeyRateLimitResult {
  allowed: boolean;
  remaining: number; // Remaining requests in window
  limit: number; // Maximum requests allowed
  resetAt: Date; // When the window resets
  retryAfter?: number; // Seconds until retry is allowed (only set if rate limited)
}

/**
 * Parse rate limit configuration from API key database fields
 */
export function parseRateLimitConfig(apiKey: {
  rateLimitEnabled?: boolean | null;
  rateLimitTimeWindow?: string | null;
  rateLimitMax?: string | null;
}): ApiKeyRateLimitConfig {
  const enabled = apiKey.rateLimitEnabled ?? true;
  const timeWindow = parseInt(apiKey.rateLimitTimeWindow ?? "60", 10) || 60;
  const maxRequests = parseInt(apiKey.rateLimitMax ?? "100", 10) || 100;

  // Enforce minimum values for safety
  return {
    enabled,
    timeWindow: Math.max(1, Math.min(timeWindow, 86400)), // 1 second to 1 day
    maxRequests: Math.max(1, Math.min(maxRequests, 100000)), // 1 to 100k
  };
}

/**
 * Get current timestamp in seconds
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * API Key Rate Limiter class with Redis-based sliding window implementation
 */
export class ApiKeyRateLimiter {
  private static instance: ApiKeyRateLimiter | null = null;

  private constructor() {}

  static getInstance(): ApiKeyRateLimiter {
    if (!ApiKeyRateLimiter.instance) {
      ApiKeyRateLimiter.instance = new ApiKeyRateLimiter();
    }
    return ApiKeyRateLimiter.instance;
  }

  /**
   * Check and increment rate limit for an API key
   *
   * Uses sliding window algorithm:
   * 1. Remove expired entries from the sorted set
   * 2. Count current entries in window
   * 3. If under limit, add new entry
   * 4. Return result
   *
   * @param apiKeyId - The API key ID
   * @param config - Rate limit configuration
   * @returns Rate limit result
   */
  async checkAndIncrement(
    apiKeyId: string,
    config: ApiKeyRateLimitConfig
  ): Promise<ApiKeyRateLimitResult> {
    // If rate limiting is disabled, always allow
    if (!config.enabled) {
      return {
        allowed: true,
        remaining: config.maxRequests,
        limit: config.maxRequests,
        resetAt: new Date(),
      };
    }

    const key = `${KEY_PREFIX}:${apiKeyId}`;
    const now = nowSeconds();
    const windowStart = now - config.timeWindow;
    const fallbackResetAt = new Date((now + config.timeWindow) * 1000);

    try {
      const redis = await getRedisConnection();

      const luaScript = `
        local key = KEYS[1]
        local windowStart = tonumber(ARGV[1])
        local now = tonumber(ARGV[2])
        local maxRequests = tonumber(ARGV[3])
        local ttl = tonumber(ARGV[4])
        local entryId = ARGV[5]

        redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
        local currentCount = redis.call('ZCARD', key)
        if currentCount >= maxRequests then
          local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
          local oldestTimestamp = oldest[2] or now
          return {0, currentCount, oldestTimestamp}
        end

        redis.call('ZADD', key, now, entryId)
        redis.call('EXPIRE', key, ttl)
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        return {1, currentCount + 1, oldest[2] or now}
      `;

      const result = (await redis.eval(
        luaScript,
        1,
        key,
        windowStart,
        now,
        config.maxRequests,
        config.timeWindow + 60,
        `${now}:${randomUUID()}`,
      )) as [number, number, number];
      const [allowed, currentCount, rawOldestTimestamp] = result;
      const oldestTimestamp = Number(rawOldestTimestamp) || now;
      const resetAt = new Date(
        (oldestTimestamp + config.timeWindow) * 1000,
      );

      if (allowed !== 1) {
        const retryAfter = Math.max(
          1,
          oldestTimestamp + config.timeWindow - now,
        );

        logger.warn(
          {
            apiKeyId: apiKeyId.substring(0, 8) + "...",
            currentCount,
            limit: config.maxRequests,
            retryAfter,
          },
          "API key rate limit exceeded"
        );

        return {
          allowed: false,
          remaining: 0,
          limit: config.maxRequests,
          resetAt,
          retryAfter,
        };
      }

      const remaining = Math.max(0, config.maxRequests - currentCount);

      logger.debug(
        {
          apiKeyId: apiKeyId.substring(0, 8) + "...",
          currentCount,
          remaining,
          limit: config.maxRequests,
        },
        "API key rate limit check passed"
      );

      return {
        allowed: true,
        remaining,
        limit: config.maxRequests,
        resetAt,
      };
    } catch (error) {
      // Rate limits protect a public credential endpoint. Redis uncertainty
      // must not silently disable the configured control.
      logger.error(
        { error, apiKeyId: apiKeyId.substring(0, 8) + "..." },
        "Rate limit check failed, rejecting request"
      );

      return {
        allowed: false,
        remaining: 0,
        limit: config.maxRequests,
        resetAt: fallbackResetAt,
        retryAfter: config.timeWindow,
      };
    }
  }

  /**
   * Get current rate limit status without incrementing
   * Useful for checking status before making a request
   */
  async getStatus(
    apiKeyId: string,
    config: ApiKeyRateLimitConfig
  ): Promise<ApiKeyRateLimitResult> {
    if (!config.enabled) {
      return {
        allowed: true,
        remaining: config.maxRequests,
        limit: config.maxRequests,
        resetAt: new Date(),
      };
    }

    const key = `${KEY_PREFIX}:${apiKeyId}`;
    const now = nowSeconds();
    const windowStart = now - config.timeWindow;

    try {
      const redis = await getRedisConnection();

      // Clean up old entries and get count
      await redis.zremrangebyscore(key, 0, windowStart);
      const [currentCount, oldest] = await Promise.all([
        redis.zcard(key),
        redis.zrange(key, 0, 0, 'WITHSCORES'),
      ]);

      const remaining = Math.max(0, config.maxRequests - currentCount);
      const allowed = remaining > 0;
      const oldestTimestamp = Number(oldest[1]) || now;
      const retryAfter = Math.max(
        1,
        oldestTimestamp + config.timeWindow - now,
      );

      return {
        allowed,
        remaining,
        limit: config.maxRequests,
        resetAt: new Date(
          (oldestTimestamp + config.timeWindow) * 1000,
        ),
        retryAfter: allowed ? undefined : retryAfter,
      };
    } catch (error) {
      logger.error({ error, apiKeyId }, "Failed to get rate limit status");
      return {
        allowed: true,
        remaining: config.maxRequests,
        limit: config.maxRequests,
        resetAt: new Date((now + config.timeWindow) * 1000),
      };
    }
  }

  /**
   * Reset rate limit counter for an API key
   * Useful for admin operations or testing
   */
  async reset(apiKeyId: string): Promise<boolean> {
    const key = `${KEY_PREFIX}:${apiKeyId}`;

    try {
      const redis = await getRedisConnection();
      await redis.del(key);
      logger.info({ apiKeyId }, "Rate limit counter reset");
      return true;
    } catch (error) {
      logger.error({ error, apiKeyId }, "Failed to reset rate limit");
      return false;
    }
  }
}

// Export singleton instance
export const apiKeyRateLimiter = ApiKeyRateLimiter.getInstance();

/**
 * Create rate limit headers for HTTP response
 */
export function createRateLimitHeaders(
  result: ApiKeyRateLimitResult
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": result.limit.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": Math.floor(result.resetAt.getTime() / 1000).toString(),
  };

  if (result.retryAfter !== undefined) {
    headers["Retry-After"] = result.retryAfter.toString();
  }

  return headers;
}
