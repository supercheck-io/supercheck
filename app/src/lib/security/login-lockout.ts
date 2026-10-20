/**
 * Login Lockout Service
 *
 * Implements progressive lockout mechanism to prevent brute force attacks.
 * Uses Redis for distributed state management.
 *
 * Lockout policy (same ladder for every blocking dimension):
 * - After 5 failed attempts: 30 second delay
 * - After 10 failed attempts: 5 minute lockout
 * - After 15 failed attempts: 15 minute lockout
 * - After 20 failed attempts: 1 hour lockout
 *
 * Blocking dimensions are only the client IP and the email+IP pair. A per-email
 * counter is kept for telemetry and future step-up verification, but it never
 * blocks a sign-in on its own: an email-only hard lock would let anyone who
 * knows an address keep its owner locked out indefinitely.
 *
 * Attempts are reserved atomically before the credential check so a parallel
 * burst cannot exceed the remaining allowance. The reservation is released when
 * the attempt did not verify a password (captcha, unverified email, transport or
 * other API errors) and cleared on success.
 */

import { randomUUID } from "node:crypto";
import { getRedisConnection } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";
import { isCloudHosted } from "@/lib/feature-flags";

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

const UNKNOWN_CLIENT_IP = "unknown";

/**
 * Single message for every lockout response. Sharing one message keeps the
 * caller from learning whether an address or an account is the locked identity.
 */
export const LOGIN_LOCKOUT_MESSAGE =
  "Too many sign-in attempts. Please try again later.";

export const CLIENT_IP_UNAVAILABLE_MESSAGE =
  "Sign-in is temporarily unavailable. Please try again later.";

let lastUnknownClientIpWarningAt = 0;

/**
 * Whether a deployment treats a missing client IP as a configuration error.
 *
 * Cloud production always requires the edge to forward X-Forwarded-For (or a
 * trusted CF-Connecting-IP). Self-hosted installs may run without a proxy, so
 * they keep working but log a warning; set REQUIRE_CLIENT_IP_FOR_SIGNIN=true to
 * enforce the same fail-closed behavior there.
 */
export function shouldRejectUnknownClientIp(): boolean {
  const explicit = process.env.REQUIRE_CLIENT_IP_FOR_SIGNIN;
  if (explicit !== undefined) {
    return explicit === "true" || explicit === "1";
  }

  return process.env.NODE_ENV === "production" && isCloudHosted();
}

/**
 * Warn (at most once a minute) that IP-based lockout is inert because the
 * request has no trustworthy client address.
 */
export function warnUnknownClientIp(): void {
  const now = Date.now();
  if (now - lastUnknownClientIpWarningAt < 60_000) return;
  lastUnknownClientIpWarningAt = now;

  logger.warn(
    {},
    "Client IP unavailable on sign-in; IP lockout is disabled. Configure X-Forwarded-For at the edge or set REQUIRE_CLIENT_IP_FOR_SIGNIN=true.",
  );
}

/** Attempts allowed before the first lockout step. */
export const LOGIN_LOCKOUT_INITIAL_ALLOWANCE: number =
  LOCKOUT_THRESHOLDS[0].attempts;

type RedisConnection = Awaited<ReturnType<typeof getRedisConnection>>;

/**
 * Reserve an attempt on all keys at once. A locked key short-circuits the whole
 * reservation so a rejected request neither increments counters nor renews a
 * lock. Returns [locked, lockoutSeconds, (attempts, appliedLockout)...].
 */
const RESERVE_ATTEMPT_SCRIPT = `
local attemptsTtl = tonumber(ARGV[1])
local thresholds = {}
local reservationToken = ARGV[2]
for index = 3, #ARGV, 2 do
  thresholds[#thresholds + 1] = { tonumber(ARGV[index]), tonumber(ARGV[index + 1]) }
end

local keyCount = #KEYS / 2
for index = 1, keyCount do
  local lockTtl = redis.call("TTL", KEYS[index * 2])
  if lockTtl > 0 then
    return { 1, lockTtl }
  end
end

local result = { 0, 0 }
for index = 1, keyCount do
  local attemptsKey = KEYS[index * 2 - 1]
  local lockKey = KEYS[index * 2]
  local attempts = redis.call("INCR", attemptsKey)
  redis.call("EXPIRE", attemptsKey, attemptsTtl)

  local applied = 0
  for _, threshold in ipairs(thresholds) do
    if attempts >= threshold[1] then
      applied = threshold[2]
    end
  end

  if applied > 0 then
    redis.call("SETEX", lockKey, applied, reservationToken)
    if applied > result[2] then
      result[2] = applied
    end
  end

  result[#result + 1] = attempts
  result[#result + 1] = applied
end

return result
`;

/**
 * Undo one reservation per key. The counter is decremented, and a lock created
 * by this reservation is removed only if its unique token still matches.
 */
const RELEASE_ATTEMPT_SCRIPT = `
for index = 1, #KEYS / 2 do
  local attemptsKey = KEYS[index * 2 - 1]
  local lockKey = KEYS[index * 2]
  local attempts = tonumber(redis.call("GET", attemptsKey) or "0")

  if attempts > 0 then
    redis.call("DECR", attemptsKey)
  end

  local applied = tonumber(ARGV[index * 2 - 1]) or 0
  if applied > 0 then
    local token = ARGV[index * 2]
    if redis.call("GET", lockKey) == token then
      redis.call("DEL", lockKey)
    end
  end
end

return 1
`;

export interface LockoutStatus {
  isLocked: boolean;
  attemptsRemaining: number;
  lockoutUntil?: Date;
  lockoutSeconds?: number;
  message?: string;
}

export interface AttemptRelease {
  identifier: string;
  appliedLockoutSeconds: number;
  reservationToken: string;
}

export interface AttemptReservation extends LockoutStatus {
  /** Reservations to undo when the attempt did not verify a password. */
  releases: AttemptRelease[];
}

/**
 * Normalize identifier to prevent enumeration via case sensitivity
 */
function normalizeIdentifier(identifier: string): string {
  return identifier.toLowerCase().trim();
}

/**
 * Blocking dimension for the client IP.
 */
export function ipLockoutIdentifier(ip: string): string {
  return `ip:${normalizeIdentifier(ip)}`;
}

/**
 * Blocking dimension for the email+IP pair.
 */
export function emailIpLockoutIdentifier(email: string, ip: string): string {
  return `pair:${normalizeIdentifier(email)}|${normalizeIdentifier(ip)}`;
}

/**
 * Per-email counter used for telemetry only. Never consulted for blocking.
 */
export function emailLockoutIdentifier(email: string): string {
  return `email:${normalizeIdentifier(email)}`;
}

/**
 * Keys that may hard-block a sign-in. Without a trustworthy client IP the IP
 * and pair dimensions collapse into one shared bucket, so they are skipped and
 * only the upstream rate limiters apply.
 */
export function blockingLockoutIdentifiers(email: string, ip: string): string[] {
  if (!ip || ip === UNKNOWN_CLIENT_IP) return [];
  return [ipLockoutIdentifier(ip), emailIpLockoutIdentifier(email, ip)];
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

async function getReadyRedisConnection(identifier: string, operation: string): Promise<RedisConnection | null> {
  const redis = await getRedisConnection();
  if (!redis || redis.status !== "ready") {
    logger.warn(
      { identifier: identifier.substring(0, 8), operation, status: redis?.status ?? "unavailable" },
      "Redis unavailable for login lockout, failing open"
    );
    return null;
  }

  return redis;
}

function parseRedisNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;

  const numbers: number[] = [];
  for (const item of value) {
    if (typeof item === "number") {
      numbers.push(item);
      continue;
    }
    if (typeof item === "string") {
      const parsed = Number(item);
      if (!Number.isFinite(parsed)) return null;
      numbers.push(parsed);
      continue;
    }
    return null;
  }

  return numbers;
}

function failOpenReservation(): AttemptReservation {
  return {
    isLocked: false,
    attemptsRemaining: LOCKOUT_THRESHOLDS[0].attempts,
    releases: [],
  };
}

/**
 * Check if an identifier is currently locked out
 *
 * Read-only: never increments a counter or renews a lock.
 *
 * @param identifier - Lockout identifier from the helpers above
 * @returns Lockout status
 */
export async function checkLockout(identifier: string): Promise<LockoutStatus> {
  const normalizedId = normalizeIdentifier(identifier);

  try {
    const redis = await getReadyRedisConnection(normalizedId, "check");
    if (!redis) {
      // Fail open if Redis unavailable
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
        "Login attempt blocked - identifier locked"
      );
      return {
        isLocked: true,
        attemptsRemaining: 0,
        lockoutUntil,
        lockoutSeconds: lockoutTTL,
        message: LOGIN_LOCKOUT_MESSAGE,
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
 * Atomically reserve one attempt on every blocking identifier.
 *
 * The increment, TTL refresh, threshold evaluation and lock creation happen in
 * a single Lua script, so concurrent sign-ins cannot all pass the check before
 * any of them is counted.
 *
 * @param identifiers - Blocking identifiers from blockingLockoutIdentifiers()
 * @returns Reservation state and the handles needed to release it
 */
export async function reserveLoginAttempt(identifiers: string[]): Promise<AttemptReservation> {
  if (identifiers.length === 0) return failOpenReservation();

  const normalizedIds = identifiers.map(normalizeIdentifier);

  try {
    const redis = await getReadyRedisConnection(normalizedIds[0], "reserve_attempt");
    if (!redis) {
      return failOpenReservation();
    }

    const keys = normalizedIds.flatMap((identifier) => [
      ATTEMPTS_KEY(identifier),
      LOCKOUT_KEY(identifier),
    ]);
    const thresholdArgs = LOCKOUT_THRESHOLDS.flatMap((threshold) => [
      threshold.attempts,
      threshold.lockoutSeconds,
    ]);

    const reservationToken = randomUUID();
    const rawResult = await redis.eval(
      RESERVE_ATTEMPT_SCRIPT,
      keys.length,
      ...keys,
      ATTEMPTS_TTL_SECONDS,
      reservationToken,
      ...thresholdArgs
    );

    const numbers = parseRedisNumbers(rawResult);
    if (!numbers || numbers.length < 2) {
      logger.error({ identifiers: normalizedIds.length }, "Unexpected lockout reservation result");
      return failOpenReservation();
    }

    const [lockedFlag, lockoutSeconds] = numbers;
    if (lockedFlag === 1) {
      logger.warn(
        { identifier: normalizedIds[0].substring(0, 8), lockoutSeconds },
        "Login attempt blocked - identifier locked"
      );
      return {
        isLocked: true,
        attemptsRemaining: 0,
        lockoutUntil: new Date(Date.now() + lockoutSeconds * 1000),
        lockoutSeconds,
        message: LOGIN_LOCKOUT_MESSAGE,
        releases: [],
      };
    }

    let attemptsRemaining: number = LOGIN_LOCKOUT_INITIAL_ALLOWANCE;
    const releases: AttemptRelease[] = [];

    normalizedIds.forEach((identifier, index) => {
      const attempts = numbers[2 + index * 2] ?? 0;
      const appliedLockoutSeconds = numbers[3 + index * 2] ?? 0;
      attemptsRemaining = Math.min(attemptsRemaining, calculateAttemptsRemaining(attempts));
      releases.push({ identifier, appliedLockoutSeconds, reservationToken });
    });

    logger.debug(
      { identifiers: normalizedIds.length, attemptsRemaining },
      "Login attempt reserved"
    );

    return {
      isLocked: false,
      attemptsRemaining,
      releases,
    };
  } catch (error) {
    logger.error({ error, identifiers: normalizedIds.length }, "Failed to reserve login attempt");
    return failOpenReservation();
  }
}

/**
 * Release a reservation whose attempt did not verify a password.
 *
 * @param releases - Release handles from reserveLoginAttempt()
 */
export async function releaseLoginAttempt(releases: AttemptRelease[]): Promise<void> {
  if (releases.length === 0) return;

  try {
    const redis = await getReadyRedisConnection(releases[0].identifier, "release_attempt");
    if (!redis) return;

    const keys = releases.flatMap(({ identifier }) => [
      ATTEMPTS_KEY(identifier),
      LOCKOUT_KEY(identifier),
    ]);
    const applied = releases.flatMap(({ appliedLockoutSeconds, reservationToken }) => [appliedLockoutSeconds, reservationToken]);

    await redis.eval(RELEASE_ATTEMPT_SCRIPT, keys.length, ...keys, ...applied);

    logger.debug({ identifiers: releases.length }, "Login attempt reservation released");
  } catch (error) {
    logger.error({ error, identifiers: releases.length }, "Failed to release login attempt");
    // Non-critical: the counter expires with its TTL.
  }
}

/**
 * Record a failed password check on the per-email counter.
 *
 * Telemetry only: nothing blocks on this counter, so a distributed attack
 * against one email cannot lock its owner out.
 *
 * @param email - Email address being attempted
 */
export async function recordEmailFailure(email: string): Promise<void> {
  const identifier = emailLockoutIdentifier(email);

  try {
    const redis = await getReadyRedisConnection(identifier, "record_email_failure");
    if (!redis) return;

    await redis
      .multi()
      .incr(ATTEMPTS_KEY(identifier))
      .expire(ATTEMPTS_KEY(identifier), ATTEMPTS_TTL_SECONDS)
      .exec();
  } catch (error) {
    logger.error({ error, identifier: identifier.substring(0, 8) }, "Failed to record email failure");
    // Telemetry is best-effort.
  }
}

/**
 * Clear attempt counters and any active lockout for one identifier.
 *
 * @param identifier - Lockout identifier
 */
export async function clearLockout(identifier: string): Promise<void> {
  const normalizedId = normalizeIdentifier(identifier);

  try {
    const redis = await getReadyRedisConnection(normalizedId, "clear");
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
    const redis = await getReadyRedisConnection(normalizedId, "get_attempt_count");
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
 * Admin function to manually unlock an identifier
 *
 * @param identifier - Lockout identifier to unlock
 * @returns Whether the unlock was successful
 */
export async function adminUnlock(identifier: string): Promise<boolean> {
  const normalizedId = normalizeIdentifier(identifier);

  try {
    const redis = await getReadyRedisConnection(normalizedId, "admin_unlock");
    if (!redis) {
      return false;
    }

    await redis.del(ATTEMPTS_KEY(normalizedId), LOCKOUT_KEY(normalizedId));

    logger.info(
      { identifier: normalizedId.substring(0, 8) },
      "Identifier manually unlocked by admin"
    );

    return true;
  } catch (error) {
    logger.error({ error, identifier: normalizedId.substring(0, 8) }, "Admin unlock failed");
    return false;
  }
}

const loginLockout = {
  checkLockout,
  reserveLoginAttempt,
  releaseLoginAttempt,
  recordEmailFailure,
  clearLockout,
  getAttemptCount,
  adminUnlock,
};

export default loginLockout;
