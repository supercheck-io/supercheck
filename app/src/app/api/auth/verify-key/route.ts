import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { apikey } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRedisConnection } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "verify-key" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

// Rate limiting configuration for verify-key endpoint
// These are deliberately restrictive to prevent enumeration attacks
const RATE_LIMIT_WINDOW_SECONDS = 60; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP
const RATE_LIMIT_KEY_PREFIX = "supercheck:verify-key:ratelimit";

/**
 * Check rate limit for the given IP address using Redis sliding window.
 * Returns true if request is allowed, false if rate limited.
 */
async function checkRateLimit(
  ip: string
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      // Fail open if Redis is unavailable
      logger.warn({ ip }, "Redis unavailable for rate limiting, allowing request");
      return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS };
    }

    const key = `${RATE_LIMIT_KEY_PREFIX}:${ip}`;
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_SECONDS * 1000;

    // Atomic operation: remove old entries, count current, add new if allowed
    const multi = redis.multi();
    
    // Remove old entries outside the window
    multi.zremrangebyscore(key, 0, windowStart);
    
    // Count entries in current window
    multi.zcard(key);
    
    // Get the oldest entry timestamp for retryAfter calculation
    multi.zrange(key, 0, 0, "WITHSCORES");
    
    const results = await multi.exec();
    
    if (!results) {
      logger.warn({ ip }, "Redis transaction failed, allowing request");
      return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS };
    }

    const currentCount = (results[1]?.[1] as number) ?? 0;
    const oldestEntry = results[2]?.[1] as string[] | undefined;
    
    if (currentCount >= RATE_LIMIT_MAX_REQUESTS) {
      // Calculate retryAfter based on oldest entry
      let retryAfter = RATE_LIMIT_WINDOW_SECONDS;
      if (oldestEntry && oldestEntry.length >= 2) {
        const oldestTimestamp = parseInt(oldestEntry[1], 10);
        const expiresAt = oldestTimestamp + RATE_LIMIT_WINDOW_SECONDS * 1000;
        retryAfter = Math.max(1, Math.ceil((expiresAt - now) / 1000));
      }
      
      logger.warn(
        { ip, count: currentCount, limit: RATE_LIMIT_MAX_REQUESTS },
        "Rate limit exceeded for verify-key endpoint"
      );
      
      return { allowed: false, remaining: 0, retryAfter };
    }

    // Add this request to the window
    await redis.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);
    
    // Set expiry on the key (slightly longer than window to handle edge cases)
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS + 10);
    
    return {
      allowed: true,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - currentCount - 1),
    };
  } catch (error) {
    // Fail open on Redis errors
    logger.error({ error, ip }, "Rate limiting error, allowing request");
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS };
  }
}

/**
 * Extract client IP from request
 */
function getClientIp(request: NextRequest): string {
  // Check common proxy headers
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // Get the first IP in the chain (original client)
    return forwardedFor.split(",")[0].trim();
  }
  
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  
  // Fallback (may not be accurate behind proxies)
  return "unknown";
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  
  // Check rate limit first
  const rateLimitResult = await checkRateLimit(clientIp);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        message: "Too many verification attempts. Please try again later.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.retryAfter ?? 60),
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }
  
  try {
    const { apiKey, jobId } = await request.json();

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "API key required",
          message: "API key is required for verification",
        },
        { status: 400 }
      );
    }

    // Basic API key format validation
    if (!apiKey.trim() || apiKey.length < 10) {
      return NextResponse.json(
        {
          error: "Invalid API key format",
          message: "API key must be at least 10 characters long",
        },
        { status: 400 }
      );
    }

    // Verify the API key
    const keyResult = await db
      .select({
        id: apikey.id,
        enabled: apikey.enabled,
        expiresAt: apikey.expiresAt,
        jobId: apikey.jobId,
        userId: apikey.userId,
        name: apikey.name,
      })
      .from(apikey)
      .where(eq(apikey.key, apiKey.trim()))
      .limit(1);

    if (keyResult.length === 0) {
      logger.warn(
        { keyPrefix: apiKey.substring(0, 8), ip: clientIp },
        "Invalid API key attempted"
      );
      return NextResponse.json(
        {
          error: "Invalid API key",
          message: "The provided API key is not valid",
        },
        { status: 401 }
      );
    }

    const key = keyResult[0];

    // Check if API key is enabled
    if (!key.enabled) {
      logger.warn(
        { keyName: key.name, keyId: key.id, ip: clientIp },
        "Disabled API key attempted"
      );
      return NextResponse.json(
        {
          error: "API key disabled",
          message: "This API key has been disabled",
        },
        { status: 401 }
      );
    }

    // Check if API key has expired
    if (key.expiresAt && new Date() > key.expiresAt) {
      logger.warn(
        { keyName: key.name, keyId: key.id, ip: clientIp },
        "Expired API key attempted"
      );
      return NextResponse.json(
        {
          error: "API key expired",
          message: "This API key has expired",
        },
        { status: 401 }
      );
    }

    // If jobId is provided, validate that the API key is authorized for this specific job
    if (jobId && key.jobId !== jobId) {
      logger.warn(
        {
          keyName: key.name,
          attemptedJobId: jobId,
          authorizedJobId: key.jobId,
          ip: clientIp,
        },
        "API key unauthorized for job"
      );
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "This API key is not authorized for the requested job",
        },
        { status: 403 }
      );
    }

    // Update last request timestamp
    await db
      .update(apikey)
      .set({ lastRequest: new Date() })
      .where(eq(apikey.id, key.id));

    // API key is valid
    return NextResponse.json({
      valid: true,
      keyId: key.id,
      jobId: key.jobId,
    });
  } catch (error) {
    logger.error({ error, ip: clientIp }, "Error verifying API key");

    // Check if this is a database connection error
    const isDbError =
      error instanceof Error &&
      (error.message.includes("connection") ||
        error.message.includes("timeout") ||
        error.message.includes("ECONNREFUSED"));

    return NextResponse.json(
      {
        error: "Authentication error",
        message: isDbError
          ? "Database connection issue. Please try again in a moment."
          : "Unable to verify API key at this time",
      },
      { status: isDbError ? 503 : 500 }
    );
  }
}

