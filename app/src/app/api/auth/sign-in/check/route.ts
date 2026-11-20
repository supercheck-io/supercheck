/** Read-only login preflight; credential outcomes are recorded by server auth hooks. */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  CLIENT_IP_UNAVAILABLE_MESSAGE,
  LOGIN_LOCKOUT_INITIAL_ALLOWANCE,
  LOGIN_LOCKOUT_MESSAGE,
  blockingLockoutIdentifiers,
  checkLockout,
  shouldRejectUnknownClientIp,
  warnUnknownClientIp,
} from "@/lib/security/login-lockout";
import { getClientIP } from "@/lib/session-security";
import { getRedisConnection } from "@/lib/queue";

// Rate limit for the check endpoint itself to prevent abuse
const CHECK_RATE_LIMIT_KEY_PREFIX = "supercheck:signin-check:ratelimit";
const CHECK_RATE_LIMIT_MAX = 20; // 20 requests per minute per IP
const CHECK_RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Rate limit the sign-in check endpoint per IP (or per email when the edge has
 * not supplied a client address) to prevent abuse.
 * Uses Redis for distributed rate limiting.
 */
async function checkEndpointRateLimit(ip: string, email: string): Promise<boolean> {
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      // If Redis is unavailable, fail closed for security
      return false;
    }

    // Without a client IP a shared bucket would rate-limit every visitor
    // together; scope the preflight limit to the email instead.
    const key = `${CHECK_RATE_LIMIT_KEY_PREFIX}:${
      ip === "unknown" ? `email:${email}` : ip
    }`;
    const now = Date.now();
    // One script so concurrent requests cannot all pass the count before any of them is recorded.
    const allowed = await redis.eval(
      `redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
      if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
      redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
      redis.call('EXPIRE', KEYS[1], ARGV[5])
      return 1`,
      1,
      key,
      now - CHECK_RATE_LIMIT_WINDOW_SECONDS * 1000,
      now,
      CHECK_RATE_LIMIT_MAX,
      `${now}:${randomUUID()}`,
      CHECK_RATE_LIMIT_WINDOW_SECONDS + 10,
    );
    return Number(allowed) === 1;
  } catch {
    // Fail closed on Redis errors for security
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
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

    // Same blocking dimensions as the sign-in hook: client IP and email+IP.
    // There is deliberately no email-only lock.
    const identifiers = blockingLockoutIdentifiers(normalizedEmail, clientIP);
    if (identifiers.length === 0) {
      if (shouldRejectUnknownClientIp()) {
        return NextResponse.json(
          {
            allowed: false,
            isLocked: true,
            message: CLIENT_IP_UNAVAILABLE_MESSAGE,
          },
          { status: 503 },
        );
      }
      warnUnknownClientIp();
    }

    // Rate limit this endpoint to prevent abuse
    const allowed = await checkEndpointRateLimit(clientIP, normalizedEmail);
    if (!allowed) {
      return NextResponse.json(
        { allowed: false, isLocked: true, message: LOGIN_LOCKOUT_MESSAGE },
        { status: 429 }
      );
    }

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
