/** Read-only login preflight; credential outcomes are recorded by server auth hooks. */

import { NextRequest, NextResponse } from "next/server";
import {
  LOGIN_LOCKOUT_INITIAL_ALLOWANCE,
  LOGIN_LOCKOUT_MESSAGE,
  blockingLockoutIdentifiers,
  checkLockout,
} from "@/lib/security/login-lockout";
import { getClientIP } from "@/lib/session-security";
import { getRedisConnection } from "@/lib/queue";

// Rate limit for the check endpoint itself to prevent abuse
const CHECK_RATE_LIMIT_KEY_PREFIX = "supercheck:signin-check:ratelimit";
const CHECK_RATE_LIMIT_MAX = 20; // 20 requests per minute per IP
const CHECK_RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Rate limit the sign-in check endpoint per IP to prevent abuse.
 * Uses Redis for distributed rate limiting.
 */
async function checkEndpointRateLimit(ip: string): Promise<boolean> {
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      // If Redis is unavailable, fail closed for security
      return false;
    }

    const key = `${CHECK_RATE_LIMIT_KEY_PREFIX}:${ip}`;
    const now = Date.now();
    const windowStart = now - CHECK_RATE_LIMIT_WINDOW_SECONDS * 1000;

    await redis.zremrangebyscore(key, 0, windowStart);
    const count = await redis.zcard(key);

    if (count >= CHECK_RATE_LIMIT_MAX) {
      return false;
    }

    await redis.zadd(key, now, `${now}`);
    await redis.expire(key, CHECK_RATE_LIMIT_WINDOW_SECONDS + 10);
    return true;
  } catch {
    // Fail closed on Redis errors for security
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, email } = body;

    if (!action) {
      return NextResponse.json(
        { error: "Action is required" },
        { status: 400 }
      );
    }

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Valid email is required" },
        { status: 400 }
      );
    }

    if (action !== "pre-check") {
      return NextResponse.json({ error: "Invalid action. Use 'pre-check'." }, { status: 400 });
    }

    // Normalize email for consistent lockout tracking
    const normalizedEmail = email.toLowerCase().trim();
    const clientIP = getClientIP(request.headers);

    // Rate limit this endpoint to prevent abuse
    const allowed = await checkEndpointRateLimit(clientIP);
    if (!allowed) {
      return NextResponse.json(
        { allowed: false, isLocked: true, message: LOGIN_LOCKOUT_MESSAGE },
        { status: 429 }
      );
    }

    // Same blocking dimensions as the sign-in hook: client IP and email+IP.
    // There is deliberately no email-only lock.
    const identifiers = blockingLockoutIdentifiers(normalizedEmail, clientIP);
    const statuses = await Promise.all(identifiers.map((identifier) => checkLockout(identifier)));
    const locked = statuses.find((status) => status.isLocked);

    if (locked) {
      return NextResponse.json({
        allowed: false,
        isLocked: true,
        message: LOGIN_LOCKOUT_MESSAGE,
        lockoutSeconds: locked.lockoutSeconds,
        lockoutUntil: locked.lockoutUntil?.toISOString(),
      }, { status: 429 });
    }

    return NextResponse.json({
      allowed: true,
      isLocked: false,
      attemptsRemaining: statuses.length > 0
        ? statuses.reduce(
            (remaining, status) => Math.min(remaining, status.attemptsRemaining),
            LOGIN_LOCKOUT_INITIAL_ALLOWANCE
          )
        : LOGIN_LOCKOUT_INITIAL_ALLOWANCE,
    });
  } catch (error) {
    console.error("Login check error:", error);

    // SECURITY: Fail CLOSED for security-sensitive operations.
    // If the lockout system is unavailable, reject sign-in attempts
    // rather than allowing potential brute force attacks through.
    return NextResponse.json({
      allowed: false,
      isLocked: true,
      message: "Security check temporarily unavailable. Please try again in a moment.",
    }, { status: 503 });
  }
}
