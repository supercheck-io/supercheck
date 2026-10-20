/**
 * Session Security Utilities
 * Implements secure session token handling and validation
 */

import crypto from "crypto";
import { isIP } from "net";

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
 * Uses constant-time comparison to prevent timing attacks
 */
export function verifySessionToken(
  token: string,
  hash: string,
  salt: string
): boolean {
  const { hash: computedHash } = hashSessionToken(token, salt);

  // Use constant-time comparison to prevent timing attacks
  // Both hashes are hex strings, so convert to buffers for comparison
  try {
    const computedBuffer = Buffer.from(computedHash, "hex");
    const hashBuffer = Buffer.from(hash, "hex");

    // Length check - if lengths differ, we still need constant-time behavior
    // timingSafeEqual throws if lengths differ, so handle that case
    if (computedBuffer.length !== hashBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(computedBuffer, hashBuffer);
  } catch {
    // If buffer conversion fails (invalid hex), return false
    return false;
  }
}

/**
 * Generate a cryptographically secure session token
 */
export function generateSecureToken(): string {
  return toHex(getRandomBytes(64));
}

/**
 * Session duration constants - aligned with Better Auth configuration in auth.ts
 * IMPORTANT: Keep these in sync with auth.ts session.expiresIn
 */
export const SESSION_DURATION = {
  MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days (matches auth.ts)
  TIMEOUT_PERIOD_MS: 24 * 60 * 60 * 1000, // 24 hours inactivity timeout
} as const;

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
 * 
 * NOTE: This function is primarily for custom session validation scenarios.
 * Better Auth handles session validation automatically for normal auth flows.
 * Use this only for advanced custom session management requirements.
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

  // Check session age (7 days max - aligned with auth.ts)
  const sessionAge = Date.now() - context.createdAt.getTime();
  if (sessionAge > SESSION_DURATION.MAX_AGE_MS) {
    return { valid: false, reason: "Session expired" };
  }

  // Check last used (24 hour inactivity timeout)
  const timeSinceLastUse = Date.now() - context.lastUsedAt.getTime();
  if (timeSinceLastUse > SESSION_DURATION.TIMEOUT_PERIOD_MS) {
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
 * Rate limiting for monitor API operations
 * Prevents abuse of monitor creation/update endpoints
 */
export async function checkMonitorApiRateLimit(
  userId: string,
  organizationId: string,
  operation: "create" | "update" | "delete",
  maxOperations = 20,
  windowMs = 60 * 1000 // 1 minute
): Promise<{ allowed: boolean; resetTime?: number; retryAfter?: number }> {
  // Use organization-scoped rate limiting to prevent cross-org abuse
  const result = await checkRateLimit(
    `monitor:${organizationId}:${userId}:${operation}`,
    maxOperations,
    windowMs
  );

  if (!result.allowed && result.resetTime) {
    const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
    return { ...result, retryAfter: Math.max(1, retryAfter) };
  }

  return result;
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
 * Rate limiting for email verification requests
 * Prevents abuse of verification email endpoint
 * Uses same limits as password reset for consistency
 */
export async function checkEmailVerificationRateLimit(
  identifier: string, // email or IP address
  maxAttempts = 3,
  windowMs = 5 * 60 * 1000 // 5 minutes (matches client-side cooldown)
): Promise<{ allowed: boolean; resetTime?: number; attemptsLeft?: number }> {
  const result = await checkRateLimit(
    `email-verification:${identifier}`,
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
      const key = `${RATE_LIMIT_KEY_PREFIX}:email-verification:${identifier}`;
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

const DEFAULT_TRUSTED_PROXY_HOPS = 0;
const UNKNOWN_CLIENT_IP = "unknown";

/**
 * Number of right-hand X-Forwarded-For entries appended by our own edge.
 *
 * The leftmost entry is whatever the client sent, so it is never trusted. We
 * walk right-to-left, discard the entries our trusted proxies appended, and
 * accept the first syntactically valid address after that.
 *
 * See docs/security/auth-lockout-and-client-ip.md for per-deployment values.
 */
function getTrustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (!raw) return DEFAULT_TRUSTED_PROXY_HOPS;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_TRUSTED_PROXY_HOPS;
}

/**
 * Strip the decorations a proxy may add around an address: brackets, an IPv4
 * port, or an IPv6 port in bracket notation.
 */
function stripAddressDecoration(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith("[")) {
    const closingBracket = trimmed.indexOf("]");
    if (closingBracket > 0) {
      return trimmed.slice(1, closingBracket);
    }
  }

  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon > 0 && trimmed.indexOf(":") === lastColon) {
    return trimmed.slice(0, lastColon);
  }

  return trimmed;
}

/**
 * Get the client IP address from request headers.
 *
 * X-Forwarded-For is right-to-left trustworthy: entries appended by our own
 * proxies are on the right, everything a client could forge is on the left.
 * `TRUST_CF_CONNECTING_IP=true` prefers CF-Connecting-IP, which Cloudflare
 * overwrites, but only when the origin is reachable exclusively through
 * Cloudflare (otherwise the header is client-controlled).
 *
 * Returns "unknown" when no trustworthy address is present.
 */
export function getClientIP(headers: Headers): string {
  if (process.env.TRUST_CF_CONNECTING_IP === "true") {
    const cloudflareIP = headers.get("cf-connecting-ip");
    if (cloudflareIP) {
      const candidate = stripAddressDecoration(cloudflareIP);
      if (isIP(candidate)) return candidate;
    }
  }

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return UNKNOWN_CLIENT_IP;

  const entries = forwarded
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const hops = getTrustedProxyHops();
  const index = entries.length - 1 - hops;
  if (index < 0) return UNKNOWN_CLIENT_IP;

  // Only the one entry the trusted edge appended may be trusted. Walking
  // further left would reach client-controlled entries when the expected
  // entry is malformed, which would let a caller rotate lockout keys.
  const candidate = stripAddressDecoration(entries[index]);
  return isIP(candidate) ? candidate : UNKNOWN_CLIENT_IP;
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
  const expiresAt = new Date(now.getTime() + SESSION_DURATION.MAX_AGE_MS);

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
