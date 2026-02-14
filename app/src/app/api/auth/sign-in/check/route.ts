/**
 * Login Pre-Check API Endpoint
 * 
 * This endpoint is called BEFORE the actual sign-in attempt to:
 * 1. Check if the account is locked out due to failed attempts
 * 2. After sign-in failure (called from client), record the failed attempt
 * 3. After sign-in success (called from client), clear the lockout
 * 
 * SECURITY HARDENING:
 * - "pre-check" is the only action allowed without rate limiting (read-only check)
 * - "failed" action is rate-limited to prevent abuse (DoS via lockout)
 * - "success" action is rate-limited and only clears lockout if called from same IP
 * - Fail-closed on errors for all security-sensitive actions
 */

import { NextRequest, NextResponse } from "next/server";
import { 
  checkLockout, 
  recordFailedAttempt, 
  clearLockout 
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

/**
 * POST /api/auth/sign-in/check
 * 
 * Actions:
 * - action: "pre-check" - Check if email/IP is locked out before attempting sign-in
 * - action: "failed" - Record a failed sign-in attempt (rate-limited)
 * - action: "success" - Clear lockout after successful sign-in (rate-limited)
 */
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

      case "failed": {
        // Record failed attempt for both email and IP
        // SECURITY: This is rate-limited above to prevent DoS via lockout flooding
        const [emailResult, ipResult] = await Promise.all([
          recordFailedAttempt(normalizedEmail),
          recordFailedAttempt(clientIP),
        ]);

        // Return the more restrictive result
        const result = emailResult.isLocked ? emailResult : ipResult;
        
        return NextResponse.json({
          isLocked: result.isLocked,
          attemptsRemaining: Math.min(
            emailResult.attemptsRemaining || 0,
            ipResult.attemptsRemaining || 0
          ),
          message: result.message,
          lockoutSeconds: result.lockoutSeconds,
          lockoutUntil: result.lockoutUntil?.toISOString(),
        });
      }

      case "success": {
        // Clear lockout for both email and IP after successful login
        // SECURITY: This is rate-limited above to prevent abuse
        await Promise.all([
          clearLockout(normalizedEmail),
          clearLockout(clientIP),
        ]);

        return NextResponse.json({
          success: true,
          message: "Lockout cleared",
        });
      }

      default:
        return NextResponse.json(
          { error: "Invalid action. Use 'pre-check', 'failed', or 'success'." },
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
