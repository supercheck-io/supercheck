/**
 * Session Security Utilities
 * Implements secure session token handling and validation
 */

import crypto from "crypto";

function getRandomBytes(size: number): Uint8Array {
  if (crypto?.randomBytes) {
    return crypto.randomBytes(size);
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const arr = new Uint8Array(size);
    globalThis.crypto.getRandomValues(arr);
    return arr;
  }

  throw new Error("No cryptographically secure random source available");
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

/**
 * Hash a session token for secure storage
 * Uses SHA-256 with salt for secure hashing
 */
export function hashSessionToken(
  token: string,
  salt?: string
): { hash: string; salt: string } {
  const tokenSalt = salt || toHex(getRandomBytes(32));

  if (!crypto?.createHash) {
    throw new Error("Hashing requires Node.js crypto");
  }

  const hash = crypto.createHash("sha256").update(token + tokenSalt).digest("hex");

  return { hash, salt: tokenSalt };
}

/**
 * Verify a session token against its hash
 */
export function verifySessionToken(
  token: string,
  hash: string,
  salt: string
): boolean {
  const { hash: computedHash } = hashSessionToken(token, salt);
  return computedHash === hash;
}

/**
 * Generate a cryptographically secure session token
 */
export function generateSecureToken(): string {
  return toHex(getRandomBytes(64));
}

/**
 * Session validation context
 */
export interface SessionValidationContext {
  tokenHash: string;
  salt: string;
  userId: string;
  createdAt: Date;
  lastUsedAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Validate session token and context
 */
export function validateSessionContext(
  token: string,
  context: SessionValidationContext,
  currentIp?: string
): {
  valid: boolean;
  reason?: string;
} {
  // Verify token hash
  if (!verifySessionToken(token, context.tokenHash, context.salt)) {
    return { valid: false, reason: "Invalid token hash" };
  }

  // Check session age (24 hour max)
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  const sessionAge = Date.now() - context.createdAt.getTime();
  if (sessionAge > maxAge) {
    return { valid: false, reason: "Session expired" };
  }

  // Check last used (2 hour timeout)
  const timeoutPeriod = 2 * 60 * 60 * 1000; // 2 hours
  const timeSinceLastUse = Date.now() - context.lastUsedAt.getTime();
  if (timeSinceLastUse > timeoutPeriod) {
    return { valid: false, reason: "Session timed out" };
  }

  // Optional: Check IP address consistency (can be disabled for mobile users)
  if (context.ipAddress && currentIp && context.ipAddress !== currentIp) {
    console.warn(
      `Session IP change detected: ${context.ipAddress} -> ${currentIp} for user ${context.userId}`
    );
    // For now, just log but don't invalidate (mobile users change IPs frequently)
  }

  return { valid: true };
}

/**
 * Rate limiting for admin and auth operations
 * Uses Redis-based sliding window for multi-instance support
 */
import { getRedisConnection } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";

const rateLimitLogger = createLogger({ module: "session-rate-limit" }) as {
  debug: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

const RATE_LIMIT_KEY_PREFIX = "supercheck:session:ratelimit";

export async function checkAdminRateLimit(
  userId: string,
  operation: string,
  maxOperations = 5,
  windowMs = 5 * 60 * 1000 // 5 minutes
): Promise<{ allowed: boolean; resetTime?: number }> {
  return checkRateLimit(
    `admin:${userId}:${operation}`,
    maxOperations,
    windowMs
  );
}

/**
 * Rate limiting for password reset requests
 * More restrictive than admin operations for security
 */
export async function checkPasswordResetRateLimit(
  identifier: string, // email or IP address
  maxAttempts = 3,
  windowMs = 15 * 60 * 1000 // 15 minutes
): Promise<{ allowed: boolean; resetTime?: number; attemptsLeft?: number }> {
  const result = await checkRateLimit(
    `password-reset:${identifier}`,
    maxAttempts,
    windowMs
  );

  if (!result.allowed) {
    return result;
  }

  // Get current count from Redis for attemptsLeft calculation
  try {
    const redis = await getRedisConnection();
    if (redis) {
      const key = `${RATE_LIMIT_KEY_PREFIX}:password-reset:${identifier}`;
      const count = await redis.zcard(key);
      const attemptsLeft = Math.max(0, maxAttempts - count);
      return { ...result, attemptsLeft };
    }
  } catch {
    // Fall through to default
  }

  return { ...result, attemptsLeft: maxAttempts - 1 };
}

/**
 * Redis-based sliding window rate limiting
 * Supports multi-instance deployments and fails open on Redis unavailability
 */
async function checkRateLimit(
  key: string,
  maxOperations: number,
  windowMs: number
): Promise<{ allowed: boolean; resetTime?: number }> {
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      // Fail open if Redis is unavailable
      rateLimitLogger.warn(
        { key },
        "Redis unavailable for rate limiting, allowing request"
      );
      return { allowed: true };
    }

    const redisKey = `${RATE_LIMIT_KEY_PREFIX}:${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Atomic pipeline: remove old entries, count current, add new if allowed
    const multi = redis.multi();

    // Remove entries outside the window
    multi.zremrangebyscore(redisKey, 0, windowStart);

    // Count current entries
    multi.zcard(redisKey);

    // Get the oldest entry for reset time calculation
    multi.zrange(redisKey, 0, 0, "WITHSCORES");

    const results = await multi.exec();

    if (!results) {
      rateLimitLogger.warn({ key }, "Redis transaction failed, allowing request");
      return { allowed: true };
    }

    const currentCount = (results[1]?.[1] as number) ?? 0;

    if (currentCount >= maxOperations) {
      // Calculate reset time from oldest entry
      const oldestEntry = results[2]?.[1] as string[] | undefined;
      let resetTime = now + windowMs;

      if (oldestEntry && oldestEntry.length >= 2) {
        const oldestTimestamp = parseInt(oldestEntry[1], 10);
        resetTime = oldestTimestamp + windowMs;
      }

      rateLimitLogger.debug(
        { key, count: currentCount, limit: maxOperations },
        "Rate limit exceeded"
      );

      return { allowed: false, resetTime };
    }

    // Add this request with unique member (timestamp + random suffix)
    const member = `${now}:${Math.random().toString(36).slice(2)}`;
    await redis.zadd(redisKey, now, member);

    // Set expiry slightly longer than window to handle edge cases
    await redis.expire(redisKey, Math.ceil(windowMs / 1000) + 10);

    return { allowed: true };
  } catch (error) {
    // Fail open on any Redis error
    rateLimitLogger.error(
      { error, key },
      "Rate limiting error, allowing request"
    );
    return { allowed: true };
  }
}

/**
 * Clean up expired rate limit entries
 * Note: With Redis implementation, this is mostly handled by Redis TTL,
 * but this function can be called to proactively clean up if needed
 */
export async function cleanupRateLimitEntries(): Promise<void> {
  // Redis TTL handles expiry automatically
  // This function is kept for API compatibility but is now a no-op
}

/**
 * Get client IP address from request headers
 */
export function getClientIP(headers: Headers): string {
  // Check common proxy headers
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  const realIP = headers.get("x-real-ip");
  if (realIP) {
    return realIP.trim();
  }

  const remoteAddr = headers.get("x-remote-addr");
  if (remoteAddr) {
    return remoteAddr.trim();
  }

  // Fallback
  return "unknown";
}

/**
 * Enhanced session creation with security features
 */
export interface SecureSessionData {
  token: string;
  tokenHash: string;
  salt: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export function createSecureSession(
  userId: string,
  ipAddress?: string,
  userAgent?: string
): SecureSessionData {
  const token = generateSecureToken();
  const { hash, salt } = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  return {
    token,
    tokenHash: hash,
    salt,
    userId,
    createdAt: now,
    expiresAt,
    ipAddress,
    userAgent,
  };
}
