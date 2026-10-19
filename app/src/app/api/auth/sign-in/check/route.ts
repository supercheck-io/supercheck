/** Read-only login preflight; credential outcomes are recorded by server auth hooks. */

import { NextRequest, NextResponse } from "next/server";
import { checkLockout } from "@/lib/security/login-lockout";
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
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    switch (action) {
      case "pre-check": {
        // Check both email and IP lockouts
        const emailLockout = await checkLockout(normalizedEmail);
        const ipLockout = await checkLockout(clientIP);

        // Use the stricter lockout if both exist
        if (emailLockout.isLocked || ipLockout.isLocked) {
          const lockout = emailLockout.isLocked ? emailLockout : ipLockout;
          return NextResponse.json({
            allowed: false,
            isLocked: true,
            message: lockout.message || "Account temporarily locked due to too many failed attempts.",
            lockoutSeconds: lockout.lockoutSeconds,
            lockoutUntil: lockout.lockoutUntil?.toISOString(),
          });
        }

        return NextResponse.json({
          allowed: true,
          isLocked: false,
          attemptsRemaining: Math.min(
            emailLockout.attemptsRemaining,
            ipLockout.attemptsRemaining
          ),
        });
      }

      default:
        return NextResponse.json(
          { error: "Invalid action. Use 'pre-check'." },
          { status: 400 }
        );
    }
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
