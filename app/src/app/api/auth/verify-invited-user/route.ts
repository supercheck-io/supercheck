import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { user } from "@/db/schema";
import { invitation } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isCloudHosted } from "@/lib/feature-flags";
import { getRedisConnection } from "@/lib/queue";

// Rate limiting to prevent abuse of email verification endpoint
const VERIFY_RATE_LIMIT_KEY_PREFIX = "supercheck:verify-invited:ratelimit";
const VERIFY_RATE_LIMIT_MAX = 10; // 10 requests per minute per IP
const VERIFY_RATE_LIMIT_WINDOW_SECONDS = 60;

async function checkVerifyRateLimit(ip: string): Promise<boolean> {
  try {
    const redis = await getRedisConnection();
    if (!redis) return true; // Fail open if Redis unavailable (non-security-critical path)

    const key = `${VERIFY_RATE_LIMIT_KEY_PREFIX}:${ip}`;
    const now = Date.now();
    const windowStart = now - VERIFY_RATE_LIMIT_WINDOW_SECONDS * 1000;

    await redis.zremrangebyscore(key, 0, windowStart);
    const count = await redis.zcard(key);

    if (count >= VERIFY_RATE_LIMIT_MAX) return false;

    await redis.zadd(key, now, `${now}`);
    await redis.expire(key, VERIFY_RATE_LIMIT_WINDOW_SECONDS + 10);
    return true;
  } catch {
    return true; // Fail open on error
  }
}

/**
 * POST /api/auth/verify-invited-user
 *
 * Marks a user's email as verified when they sign up via invitation.
 * This is because the invitation system already verifies ownership of
 * the email address (the invite was sent to that specific email).
 *
 * This endpoint is called WITHOUT authentication since the user
 * can't sign in until their email is verified.
 *
 * Requirements:
 * - Token must be a valid pending invitation
 * - Email must match invitation email
 * - User with that email must exist in the database
 */
export async function POST(request: NextRequest) {
  try {
    // Only relevant in cloud mode
    if (!isCloudHosted()) {
      return NextResponse.json({
        success: true,
        message: "Self-hosted mode - no verification needed",
      });
    }

    // Rate limit to prevent abuse
    const clientIP = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";
    const allowed = await checkVerifyRateLimit(clientIP);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const { token, email } = await request.json();

    if (!token || !email) {
      return NextResponse.json(
        { error: "Invitation token and email are required" },
        { status: 400 }
      );
    }

    // Verify the invitation exists and matches the email
    const inviteDetails = await db
      .select({
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      })
      .from(invitation)
      .where(eq(invitation.id, token))
      .limit(1);

    if (inviteDetails.length === 0) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 }
      );
    }

    const invite = inviteDetails[0];

    // Verify invitation is valid
    if (invite.status !== "pending") {
      return NextResponse.json(
        { error: "Invitation has already been used" },
        { status: 400 }
      );
    }

    if (new Date() > invite.expiresAt) {
      return NextResponse.json(
        { error: "Invitation has expired" },
        { status: 400 }
      );
    }

    // Verify email matches invitation
    if (email.toLowerCase() !== invite.email.toLowerCase()) {
      return NextResponse.json(
        { error: "Email does not match invitation" },
        { status: 400 }
      );
    }

    // Find and update the user with this email
    const existingUser = await db
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.email, email.toLowerCase()))
      .limit(1);

    if (existingUser.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Mark user's email as verified
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, existingUser[0].id));

    console.log(`✅ Email verified for invited user: ${email}`);

    return NextResponse.json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    console.error("Error verifying invited user:", error);
    return NextResponse.json(
      { error: "Failed to verify user" },
      { status: 500 }
    );
  }
}
