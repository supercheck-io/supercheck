/**
 * Login Lockout Service
 * 
 * Implements progressive lockout mechanism to prevent brute force attacks.
 * Uses Redis for distributed state management.
 * 
 * Lockout policy:
 * - After 5 failed attempts: 30 second delay
 * - After 10 failed attempts: 5 minute lockout
 * - After 15 failed attempts: 15 minute lockout
 * - After 20 failed attempts: 1 hour lockout
 * 
 * Successful login resets the counter.
 */

import { getRedisConnection } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "login-lockout" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

// Redis key prefixes
const KEY_PREFIX = "supercheck:login:lockout";
const ATTEMPTS_KEY = (identifier: string) => `${KEY_PREFIX}:attempts:${identifier}`;
const LOCKOUT_KEY = (identifier: string) => `${KEY_PREFIX}:locked:${identifier}`;

// Lockout configuration
const LOCKOUT_THRESHOLDS = [
  { attempts: 5, lockoutSeconds: 30 },      // 30 seconds after 5 attempts
  { attempts: 10, lockoutSeconds: 300 },    // 5 minutes after 10 attempts
  { attempts: 15, lockoutSeconds: 900 },    // 15 minutes after 15 attempts
  { attempts: 20, lockoutSeconds: 3600 },   // 1 hour after 20 attempts
] as const;

// Attempts expire after 24 hours of no activity
const ATTEMPTS_TTL_SECONDS = 24 * 60 * 60;

export interface LockoutStatus {
  isLocked: boolean;
  attemptsRemaining: number;
  lockoutUntil?: Date;
  lockoutSeconds?: number;
  message?: string;
}

/**
 * Normalize identifier to prevent enumeration via case sensitivity
 */
function normalizeIdentifier(identifier: string): string {
  return identifier.toLowerCase().trim();
}

/**
 * Calculate lockout duration based on attempt count
 */
function calculateLockoutSeconds(attempts: number): number | null {
  // Find the highest threshold that applies
  for (let i = LOCKOUT_THRESHOLDS.length - 1; i >= 0; i--) {
    if (attempts >= LOCKOUT_THRESHOLDS[i].attempts) {
      return LOCKOUT_THRESHOLDS[i].lockoutSeconds;
    }
  }
  return null; // No lockout yet
}

/**
 * Calculate remaining attempts before next threshold
 */
function calculateAttemptsRemaining(attempts: number): number {
  const nextThreshold = LOCKOUT_THRESHOLDS.find(t => t.attempts > attempts);
  if (nextThreshold) {
    return nextThreshold.attempts - attempts;
  }
  return 0; // Already at max lockout
}

/**
 * Check if an identifier is currently locked out
 * 
 * @param identifier - Email address or IP to check
 * @returns Lockout status
 */
export async function checkLockout(identifier: string): Promise<LockoutStatus> {
  const normalizedId = normalizeIdentifier(identifier);
  
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      // Fail open if Redis unavailable
      logger.warn(
        { identifier: normalizedId.substring(0, 8) },
        "Redis unavailable for lockout check, allowing request"
      );
      return {
        isLocked: false,
        attemptsRemaining: LOCKOUT_THRESHOLDS[0].attempts,
      };
    }

    // Check if currently locked out
    const lockoutTTL = await redis.ttl(LOCKOUT_KEY(normalizedId));
    if (lockoutTTL > 0) {
      const lockoutUntil = new Date(Date.now() + lockoutTTL * 1000);
      logger.warn(
        { identifier: normalizedId.substring(0, 8), lockoutSeconds: lockoutTTL },
        "Login attempt blocked - account locked"
      );
      return {
        isLocked: true,
        attemptsRemaining: 0,
        lockoutUntil,
        lockoutSeconds: lockoutTTL,
        message: `Account temporarily locked. Try again in ${formatDuration(lockoutTTL)}.`,
      };
    }

    // Get current attempt count
    const attempts = parseInt(await redis.get(ATTEMPTS_KEY(normalizedId)) || "0", 10);
    const attemptsRemaining = calculateAttemptsRemaining(attempts);

    return {
      isLocked: false,
      attemptsRemaining,
    };
  } catch (error) {
    logger.error({ error, identifier: normalizedId.substring(0, 8) }, "Lockout check failed");
    // Fail open on error
    return {
      isLocked: false,
      attemptsRemaining: LOCKOUT_THRESHOLDS[0].attempts,
    };
  }
}

/**
 * Record a failed login attempt
 * Increments the counter and applies lockout if threshold reached
 * 
 * @param identifier - Email address or IP
 * @returns Updated lockout status
 */
export async function recordFailedAttempt(identifier: string): Promise<LockoutStatus> {
  const normalizedId = normalizeIdentifier(identifier);
  
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      logger.warn(
        { identifier: normalizedId.substring(0, 8) },
        "Redis unavailable for recording failed attempt"
      );
      return {
        isLocked: false,
        attemptsRemaining: LOCKOUT_THRESHOLDS[0].attempts,
      };
    }

    // Check if already locked
    const existingLockout = await redis.ttl(LOCKOUT_KEY(normalizedId));
    if (existingLockout > 0) {
      return {
        isLocked: true,
        attemptsRemaining: 0,
        lockoutUntil: new Date(Date.now() + existingLockout * 1000),
        lockoutSeconds: existingLockout,
        message: `Account temporarily locked. Try again in ${formatDuration(existingLockout)}.`,
      };
    }

    // Increment attempt counter
    const attempts = await redis.incr(ATTEMPTS_KEY(normalizedId));
    await redis.expire(ATTEMPTS_KEY(normalizedId), ATTEMPTS_TTL_SECONDS);

    logger.debug(
      { identifier: normalizedId.substring(0, 8), attempts },
      "Failed login attempt recorded"
    );

    // Check if we need to apply a lockout
    const lockoutSeconds = calculateLockoutSeconds(attempts);
    if (lockoutSeconds) {
      // Apply lockout
      await redis.setex(LOCKOUT_KEY(normalizedId), lockoutSeconds, "1");
      
      logger.warn(
        { identifier: normalizedId.substring(0, 8), attempts, lockoutSeconds },
        "Account locked due to too many failed attempts"
      );

      return {
        isLocked: true,
        attemptsRemaining: 0,
        lockoutUntil: new Date(Date.now() + lockoutSeconds * 1000),
        lockoutSeconds,
        message: `Too many failed attempts. Account locked for ${formatDuration(lockoutSeconds)}.`,
      };
    }

    const attemptsRemaining = calculateAttemptsRemaining(attempts);
    
    return {
      isLocked: false,
      attemptsRemaining,
      message: attemptsRemaining <= 3 
        ? `Warning: ${attemptsRemaining} attempt(s) remaining before temporary lockout.`
        : undefined,
    };
  } catch (error) {
    logger.error({ error, identifier: normalizedId.substring(0, 8) }, "Failed to record attempt");
    return {
      isLocked: false,
      attemptsRemaining: LOCKOUT_THRESHOLDS[0].attempts,
    };
  }
}

/**
 * Clear lockout and attempt counter after successful login
 * 
 * @param identifier - Email address or IP
 */
export async function clearLockout(identifier: string): Promise<void> {
  const normalizedId = normalizeIdentifier(identifier);
  
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      return;
    }

    // Clear both the attempts counter and any active lockout
    await redis.del(ATTEMPTS_KEY(normalizedId), LOCKOUT_KEY(normalizedId));
    
    logger.debug(
      { identifier: normalizedId.substring(0, 8) },
      "Login lockout cleared after successful login"
    );
  } catch (error) {
    logger.error({ error, identifier: normalizedId.substring(0, 8) }, "Failed to clear lockout");
    // Non-critical, don't throw
  }
}

/**
 * Get current attempt count (for admin/debugging purposes)
 */
export async function getAttemptCount(identifier: string): Promise<number> {
  const normalizedId = normalizeIdentifier(identifier);
  
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      return 0;
    }

    const attempts = await redis.get(ATTEMPTS_KEY(normalizedId));
    return parseInt(attempts || "0", 10);
  } catch {
    return 0;
  }
}

/**
 * Format lockout duration for display
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Admin function to manually unlock an account
 * 
 * @param identifier - Email address or IP to unlock
 * @returns Whether the unlock was successful
 */
export async function adminUnlock(identifier: string): Promise<boolean> {
  const normalizedId = normalizeIdentifier(identifier);
  
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      return false;
    }

    await redis.del(ATTEMPTS_KEY(normalizedId), LOCKOUT_KEY(normalizedId));
    
    logger.info(
      { identifier: normalizedId.substring(0, 8) },
      "Account manually unlocked by admin"
    );
    
    return true;
  } catch (error) {
    logger.error({ error, identifier: normalizedId.substring(0, 8) }, "Admin unlock failed");
    return false;
  }
}

const loginLockout = {
  checkLockout,
  recordFailedAttempt,
  clearLockout,
  getAttemptCount,
  adminUnlock,
};

export default loginLockout;
