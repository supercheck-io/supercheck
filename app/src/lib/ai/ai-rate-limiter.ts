/**
 * AI Rate Limiter Service
 *
 * Redis-based multi-tier rate limiting for AI features.
 * Implements sliding window rate limiting with:
 * - Per-user limits
 * - Per-organization limits
 * - Per-IP limits (for unauthenticated requests)
 * - Token cost limits
 *
 * Rate limits are generous for production use while preventing abuse.
 */

import { getRedisConnection } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "ai-rate-limiter" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

// Rate limit configuration with generous production limits
// These limits are higher than the security assessment recommendations
// to balance security with user experience
export interface RateLimitConfig {
  // Per-user limits (identified by user ID)
  user: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
  // Per-organization limits (aggregate of all users)
  org: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
  // Per-IP limits (fallback for unauthenticated requests)
  ip: {
    perMinute: number;
    perHour: number;
  };
  // Token cost limits per organization per hour
  tokenCostPerHour: number;
}

// Default rate limits - generous for production
// Plus tier limits (default plan)
export const PLUS_TIER_LIMITS: RateLimitConfig = {
  user: {
    perMinute: 10, // 10 requests per minute
    perHour: 60, // 60 requests per hour
    perDay: 200, // 200 requests per day
  },
  org: {
    perMinute: 30, // 30 requests per minute (org-wide)
    perHour: 200, // 200 requests per hour
    perDay: 600, // 600 requests per day
  },
  ip: {
    perMinute: 5, // 5 requests per minute (unauthenticated fallback)
    perHour: 30, // 30 requests per hour
  },
  tokenCostPerHour: 200_000, // 200K tokens per hour
};

// Pro tier limits (higher limits for professional teams)
export const PRO_TIER_LIMITS: RateLimitConfig = {
  user: {
    perMinute: 15, // 15 requests per minute
    perHour: 100, // 100 requests per hour
    perDay: 500, // 500 requests per day
  },
  org: {
    perMinute: 50, // 50 requests per minute (org-wide)
    perHour: 400, // 400 requests per hour
    perDay: 1500, // 1500 requests per day
  },
  ip: {
    perMinute: 8, // 8 requests per minute
    perHour: 50, // 50 requests per hour
  },
  tokenCostPerHour: 500_000, // 500K tokens per hour
};

// Self-hosted mode has no limits
export const SELF_HOSTED_LIMITS: RateLimitConfig = {
  user: {
    perMinute: Number.MAX_SAFE_INTEGER,
    perHour: Number.MAX_SAFE_INTEGER,
    perDay: Number.MAX_SAFE_INTEGER,
  },
  org: {
    perMinute: Number.MAX_SAFE_INTEGER,
    perHour: Number.MAX_SAFE_INTEGER,
    perDay: Number.MAX_SAFE_INTEGER,
  },
  ip: {
    perMinute: Number.MAX_SAFE_INTEGER,
    perHour: Number.MAX_SAFE_INTEGER,
  },
  tokenCostPerHour: Number.MAX_SAFE_INTEGER,
};

// Rate limit result
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date;
  retryAfter?: number; // seconds until retry is allowed
  limitType?: "user" | "org" | "ip" | "token";
}

// Redis key prefixes
const KEY_PREFIX = "supercheck:ai:ratelimit";
const USER_KEY = `${KEY_PREFIX}:user`;
const ORG_KEY = `${KEY_PREFIX}:org`;
const IP_KEY = `${KEY_PREFIX}:ip`;
const TOKEN_KEY = `${KEY_PREFIX}:tokens`;

/**
 * Get current timestamp in seconds
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Get rate limits based on organization tier
 * Only PLUS and PRO tiers are supported
 */
function getLimitsForTier(tier?: string): RateLimitConfig {
  // Self-hosted mode has no rate limits
  if (process.env.SELF_HOSTED === "true") {
    return SELF_HOSTED_LIMITS;
  }

  switch (tier?.toLowerCase()) {
    case "pro":
      return PRO_TIER_LIMITS;
    case "plus":
    default:
      // Default to PLUS tier for all users
      return PLUS_TIER_LIMITS;
  }
}

/**
 * AI Rate Limiter class with Redis-based sliding window implementation
 */
export class AIRateLimiter {
  private static instance: AIRateLimiter | null = null;

  private constructor() {}

  static getInstance(): AIRateLimiter {
    if (!AIRateLimiter.instance) {
      AIRateLimiter.instance = new AIRateLimiter();
    }
    return AIRateLimiter.instance;
  }

  /**
   * Check rate limit using sliding window algorithm
   * Returns true if request is allowed, false if rate limited
   */
  private async checkSlidingWindow(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; count: number; resetAt: Date }> {
    try {
      const redis = await getRedisConnection();
      const now = nowSeconds();
      const windowStart = now - windowSeconds;

      // Use Redis MULTI for atomic operations
      const pipeline = redis.multi();

      // Remove old entries outside the window
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Count current entries in window
      pipeline.zcard(key);

      // Add current request with timestamp as score
      pipeline.zadd(key, now, `${now}:${Math.random()}`);

      // Set expiry to prevent orphaned keys
      pipeline.expire(key, windowSeconds + 60);

      const results = await pipeline.exec();

      if (!results) {
        // Redis error - fail open but log
        logger.warn({ key }, "Redis pipeline returned null, allowing request");
        return {
          allowed: true,
          count: 0,
          resetAt: new Date(Date.now() + windowSeconds * 1000),
        };
      }

      // Get count from second command (zcard)
      const currentCount = (results[1]?.[1] as number) || 0;
      const allowed = currentCount < limit;

      // Calculate reset time
      const resetAt = new Date((now + windowSeconds) * 1000);

      return { allowed, count: currentCount, resetAt };
    } catch (error) {
      // Redis error - fail open with warning
      logger.error({ error, key }, "Rate limit check failed, allowing request");
      return { allowed: true, count: 0, resetAt: new Date() };
    }
  }

  /**
   * Check user rate limit
   */
  async checkUserLimit(
    userId: string,
    tier?: string
  ): Promise<RateLimitResult> {
    const limits = getLimitsForTier(tier);

    // Check per-minute limit
    const minuteKey = `${USER_KEY}:${userId}:minute`;
    const minuteResult = await this.checkSlidingWindow(
      minuteKey,
      limits.user.perMinute,
      60
    );

    if (!minuteResult.allowed) {
      return {
        allowed: false,
        remaining: 0,
        limit: limits.user.perMinute,
        resetAt: minuteResult.resetAt,
        retryAfter: Math.ceil(
          (minuteResult.resetAt.getTime() - Date.now()) / 1000
        ),
        limitType: "user",
      };
    }

    // Check per-hour limit
    const hourKey = `${USER_KEY}:${userId}:hour`;
    const hourResult = await this.checkSlidingWindow(
      hourKey,
      limits.user.perHour,
      3600
    );

    if (!hourResult.allowed) {
      return {
        allowed: false,
        remaining: 0,
        limit: limits.user.perHour,
        resetAt: hourResult.resetAt,
        retryAfter: Math.ceil(
          (hourResult.resetAt.getTime() - Date.now()) / 1000
        ),
        limitType: "user",
      };
    }

    // Check per-day limit
    const dayKey = `${USER_KEY}:${userId}:day`;
    const dayResult = await this.checkSlidingWindow(
      dayKey,
      limits.user.perDay,
      86400
    );

    if (!dayResult.allowed) {
      return {
        allowed: false,
        remaining: 0,
        limit: limits.user.perDay,
        resetAt: dayResult.resetAt,
        retryAfter: Math.ceil(
          (dayResult.resetAt.getTime() - Date.now()) / 1000
        ),
        limitType: "user",
      };
    }

    return {
      allowed: true,
      remaining: Math.min(
        limits.user.perMinute - minuteResult.count,
        limits.user.perHour - hourResult.count,
        limits.user.perDay - dayResult.count
      ),
      limit: limits.user.perMinute,
      resetAt: minuteResult.resetAt,
    };
  }

  /**
   * Check organization rate limit
   */
  async checkOrgLimit(orgId: string, tier?: string): Promise<RateLimitResult> {
    const limits = getLimitsForTier(tier);

    // Check per-minute limit
    const minuteKey = `${ORG_KEY}:${orgId}:minute`;
    const minuteResult = await this.checkSlidingWindow(
      minuteKey,
      limits.org.perMinute,
      60
    );

    if (!minuteResult.allowed) {
      return {
        allowed: false,
        remaining: 0,
        limit: limits.org.perMinute,
        resetAt: minuteResult.resetAt,
        retryAfter: Math.ceil(
          (minuteResult.resetAt.getTime() - Date.now()) / 1000
        ),
        limitType: "org",
      };
    }

    // Check per-hour limit
    const hourKey = `${ORG_KEY}:${orgId}:hour`;
    const hourResult = await this.checkSlidingWindow(
      hourKey,
      limits.org.perHour,
      3600
    );

    if (!hourResult.allowed) {
      return {
        allowed: false,
        remaining: 0,
        limit: limits.org.perHour,
        resetAt: hourResult.resetAt,
        retryAfter: Math.ceil(
          (hourResult.resetAt.getTime() - Date.now()) / 1000
        ),
        limitType: "org",
      };
    }

    // Check per-day limit
    const dayKey = `${ORG_KEY}:${orgId}:day`;
    const dayResult = await this.checkSlidingWindow(
      dayKey,
      limits.org.perDay,
      86400
    );

    if (!dayResult.allowed) {
      return {
        allowed: false,
        remaining: 0,
        limit: limits.org.perDay,
        resetAt: dayResult.resetAt,
        retryAfter: Math.ceil(
          (dayResult.resetAt.getTime() - Date.now()) / 1000
        ),
        limitType: "org",
      };
    }

    return {
      allowed: true,
      remaining: Math.min(
        limits.org.perMinute - minuteResult.count,
        limits.org.perHour - hourResult.count,
        limits.org.perDay - dayResult.count
      ),
      limit: limits.org.perMinute,
      resetAt: minuteResult.resetAt,
    };
  }

  /**
   * Check IP rate limit (fallback for unauthenticated requests)
   */
  async checkIpLimit(ip: string): Promise<RateLimitResult> {
    const limits = getLimitsForTier(); // Default to free tier for IP-based limits

    // Normalize IP (handle IPv6 mapped IPv4)
    const normalizedIp = ip.replace(/^::ffff:/, "");

    // Check per-minute limit
    const minuteKey = `${IP_KEY}:${normalizedIp}:minute`;
    const minuteResult = await this.checkSlidingWindow(
      minuteKey,
      limits.ip.perMinute,
      60
    );

    if (!minuteResult.allowed) {
      return {
        allowed: false,
        remaining: 0,
        limit: limits.ip.perMinute,
        resetAt: minuteResult.resetAt,
        retryAfter: Math.ceil(
          (minuteResult.resetAt.getTime() - Date.now()) / 1000
        ),
        limitType: "ip",
      };
    }

    // Check per-hour limit
    const hourKey = `${IP_KEY}:${normalizedIp}:hour`;
    const hourResult = await this.checkSlidingWindow(
      hourKey,
      limits.ip.perHour,
      3600
    );

    if (!hourResult.allowed) {
      return {
        allowed: false,
        remaining: 0,
        limit: limits.ip.perHour,
        resetAt: hourResult.resetAt,
        retryAfter: Math.ceil(
          (hourResult.resetAt.getTime() - Date.now()) / 1000
        ),
        limitType: "ip",
      };
    }

    return {
      allowed: true,
      remaining: Math.min(
        limits.ip.perMinute - minuteResult.count,
        limits.ip.perHour - hourResult.count
      ),
      limit: limits.ip.perMinute,
      resetAt: minuteResult.resetAt,
    };
  }

  /**
   * Track token usage and check against token cost limits
   */
  async checkAndTrackTokens(
    orgId: string,
    tokensUsed: number,
    tier?: string
  ): Promise<RateLimitResult> {
    const limits = getLimitsForTier(tier);
    const key = `${TOKEN_KEY}:${orgId}:hour`;
    const now = nowSeconds();
    const windowSeconds = 3600; // 1 hour window

    try {
      const redis = await getRedisConnection();

      // Atomic increment with TTL
      const pipeline = redis.multi();
      pipeline.zremrangebyscore(key, 0, now - windowSeconds);
      pipeline.zincrby(key, tokensUsed, `${now}:${Math.random()}`);
      pipeline.zrangebyscore(key, now - windowSeconds, "+inf");
      pipeline.expire(key, windowSeconds + 60);

      const results = await pipeline.exec();

      if (!results) {
        return {
          allowed: true,
          remaining: limits.tokenCostPerHour,
          limit: limits.tokenCostPerHour,
          resetAt: new Date(),
        };
      }

      // Calculate total tokens in window
      const entries = results[2]?.[1] as string[] | undefined;
      let totalTokens = 0;
      if (entries) {
        // Sum up all token counts (stored as scores)
        const scores = await redis.zrangebyscore(
          key,
          now - windowSeconds,
          "+inf",
          "WITHSCORES"
        );
        for (let i = 1; i < scores.length; i += 2) {
          totalTokens += parseFloat(scores[i]);
        }
      }

      const allowed = totalTokens <= limits.tokenCostPerHour;
      const resetAt = new Date((now + windowSeconds) * 1000);

      return {
        allowed,
        remaining: Math.max(0, limits.tokenCostPerHour - totalTokens),
        limit: limits.tokenCostPerHour,
        resetAt,
        retryAfter: allowed
          ? undefined
          : Math.ceil((resetAt.getTime() - Date.now()) / 1000),
        limitType: "token",
      };
    } catch (error) {
      logger.error({ error, orgId }, "Token tracking failed, allowing request");
      return {
        allowed: true,
        remaining: limits.tokenCostPerHour,
        limit: limits.tokenCostPerHour,
        resetAt: new Date(),
      };
    }
  }

  /**
   * Comprehensive rate limit check for AI requests
   * Checks all applicable limits and returns the most restrictive result
   */
  async checkRateLimit(options: {
    userId?: string;
    orgId?: string;
    ip?: string;
    tier?: string;
  }): Promise<RateLimitResult> {
    const { userId, orgId, ip, tier } = options;

    // Check user limit if userId is provided
    if (userId) {
      const userResult = await this.checkUserLimit(userId, tier);
      if (!userResult.allowed) {
        logger.warn({ userId, result: userResult }, "User rate limit exceeded");
        return userResult;
      }
    }

    // Check org limit if orgId is provided
    if (orgId) {
      const orgResult = await this.checkOrgLimit(orgId, tier);
      if (!orgResult.allowed) {
        logger.warn({ orgId, result: orgResult }, "Org rate limit exceeded");
        return orgResult;
      }
    }

    // Check IP limit as fallback or additional protection
    if (ip) {
      const ipResult = await this.checkIpLimit(ip);
      if (!ipResult.allowed) {
        logger.warn({ ip, result: ipResult }, "IP rate limit exceeded");
        return ipResult;
      }
    }

    // All checks passed
    return {
      allowed: true,
      remaining: Number.MAX_SAFE_INTEGER, // Will be refined by individual checks
      limit: 0,
      resetAt: new Date(),
    };
  }

  /**
   * Get current usage statistics for an organization
   */
  async getUsageStats(orgId: string): Promise<{
    user: { minute: number; hour: number; day: number };
    org: { minute: number; hour: number; day: number };
    tokens: number;
  }> {
    try {
      const redis = await getRedisConnection();
      const now = nowSeconds();

      const pipeline = redis.multi();

      // Get org usage counts
      pipeline.zcount(`${ORG_KEY}:${orgId}:minute`, now - 60, "+inf");
      pipeline.zcount(`${ORG_KEY}:${orgId}:hour`, now - 3600, "+inf");
      pipeline.zcount(`${ORG_KEY}:${orgId}:day`, now - 86400, "+inf");

      // Get token usage
      pipeline.zrangebyscore(
        `${TOKEN_KEY}:${orgId}:hour`,
        now - 3600,
        "+inf",
        "WITHSCORES"
      );

      const results = await pipeline.exec();

      let totalTokens = 0;
      if (results && results[3]?.[1]) {
        const scores = results[3][1] as string[];
        for (let i = 1; i < scores.length; i += 2) {
          totalTokens += parseFloat(scores[i]);
        }
      }

      return {
        user: { minute: 0, hour: 0, day: 0 }, // Would need specific user ID
        org: {
          minute: (results?.[0]?.[1] as number) || 0,
          hour: (results?.[1]?.[1] as number) || 0,
          day: (results?.[2]?.[1] as number) || 0,
        },
        tokens: totalTokens,
      };
    } catch (error) {
      logger.error({ error, orgId }, "Failed to get usage stats");
      return {
        user: { minute: 0, hour: 0, day: 0 },
        org: { minute: 0, hour: 0, day: 0 },
        tokens: 0,
      };
    }
  }
}

// Export singleton instance
export const aiRateLimiter = AIRateLimiter.getInstance();
