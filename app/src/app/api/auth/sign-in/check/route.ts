/**
 * Login Pre-Check API Endpoint
 * 
 * This endpoint is called BEFORE the actual sign-in attempt to:
 * 1. Check if the account is locked out due to failed attempts
 * 2. After sign-in failure (called from client), record the failed attempt
 * 3. After sign-in success (called from client), clear the lockout
 */

import { NextRequest, NextResponse } from "next/server";
import { 
  checkLockout, 
  recordFailedAttempt, 
  clearLockout 
} from "@/lib/security/login-lockout";
import { getClientIP } from "@/lib/session-security";

/**
 * POST /api/auth/sign-in/check
 * 
 * Actions:
 * - action: "pre-check" - Check if email/IP is locked out before attempting sign-in
 * - action: "failed" - Record a failed sign-in attempt
 * - action: "success" - Clear lockout after successful sign-in
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
    
    // Fail open - don't block legitimate users due to errors
    return NextResponse.json({
      allowed: true,
      isLocked: false,
      error: "Lockout check unavailable",
    });
  }
}
