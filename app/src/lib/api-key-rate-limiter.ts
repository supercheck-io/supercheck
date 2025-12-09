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
 * - Fail-open behavior on Redis errors
 * - Detailed rate limit headers for responses
 */

import { getRedisConnection } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";

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
    const resetAt = new Date((now + config.timeWindow) * 1000);

    try {
      const redis = await getRedisConnection();

      // Use Redis MULTI for atomic operations
      const pipeline = redis.multi();

      // Remove old entries outside the window
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Count current entries in window (before adding new one)
      pipeline.zcard(key);

      // Execute first part to get current count
      const countResults = await pipeline.exec();

      if (!countResults) {
        // Redis error - fail open
        logger.warn(
          { apiKeyId },
          "Redis pipeline returned null, allowing request"
        );
        return {
          allowed: true,
          remaining: config.maxRequests,
          limit: config.maxRequests,
          resetAt,
        };
      }

      const currentCount = (countResults[1]?.[1] as number) || 0;

      // Check if we're at the limit
      if (currentCount >= config.maxRequests) {
        // Rate limited - don't add new entry
        // To calculate accurate retry-after, get the oldest entry in the window
        // The oldest entry will be the first to expire from the sliding window
        let retryAfter = config.timeWindow; // Default fallback

        try {
          // Get the oldest entry (lowest score) from the sorted set
          const oldestEntries = await redis.zrange(key, 0, 0, "WITHSCORES");
          if (oldestEntries && oldestEntries.length >= 2) {
            const oldestTimestamp = parseInt(oldestEntries[1], 10);
            // Retry after = when oldest entry will leave the window
            // oldestTimestamp + timeWindow - now = seconds until oldest entry expires
            retryAfter = Math.max(1, (oldestTimestamp + config.timeWindow) - now);
          }
        } catch (oldestError) {
          // If we can't get oldest entry, use full window as fallback
          logger.debug(
            { error: oldestError },
            "Could not get oldest entry for retry calculation"
          );
        }

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

      // Under limit - add new entry with timestamp as score
      // Use random suffix to allow multiple requests in same second
      const entryId = `${now}:${Math.random().toString(36).substring(2, 10)}`;
      await redis.zadd(key, now, entryId);

      // Set expiry to prevent orphaned keys (window + buffer)
      await redis.expire(key, config.timeWindow + 60);

      const remaining = Math.max(0, config.maxRequests - currentCount - 1);

      logger.debug(
        {
          apiKeyId: apiKeyId.substring(0, 8) + "...",
          currentCount: currentCount + 1,
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
      // Redis error - fail open with warning
      logger.error(
        { error, apiKeyId: apiKeyId.substring(0, 8) + "..." },
        "Rate limit check failed, allowing request"
      );

      return {
        allowed: true,
        remaining: config.maxRequests,
        limit: config.maxRequests,
        resetAt,
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
    const resetAt = new Date((now + config.timeWindow) * 1000);

    try {
      const redis = await getRedisConnection();

      // Clean up old entries and get count
      await redis.zremrangebyscore(key, 0, windowStart);
      const currentCount = await redis.zcard(key);

      const remaining = Math.max(0, config.maxRequests - currentCount);
      const allowed = remaining > 0;

      return {
        allowed,
        remaining,
        limit: config.maxRequests,
        resetAt,
        retryAfter: allowed ? undefined : config.timeWindow,
      };
    } catch (error) {
      logger.error({ error, apiKeyId }, "Failed to get rate limit status");
      return {
        allowed: true,
        remaining: config.maxRequests,
        limit: config.maxRequests,
        resetAt,
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
