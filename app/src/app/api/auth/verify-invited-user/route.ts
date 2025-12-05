import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { user } from "@/db/schema";
import { invitation } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isCloudHosted } from "@/lib/feature-flags";

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
