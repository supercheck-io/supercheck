import { auth } from "@/utils/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { invitation } from "@/db/schema";
import { eq, and } from "drizzle-orm";

const betterAuthHandler = toNextJsHandler(auth);

export const GET = betterAuthHandler.GET;

/**
 * POST /api/auth/sign-up/email
 * 
 * SECURITY: Email/password sign-up is INVITE-ONLY.
 * Users must have a valid pending invitation to register with email/password.
 * This is enforced at the API boundary (not just UI redirects).
 */
export async function POST(request: NextRequest) {
  // Enforce invite-only sign-up
  try {
    // Clone the request so we can read the body without consuming it
    const clonedRequest = request.clone();
    const body = await clonedRequest.json();
    const email = body?.email?.toLowerCase()?.trim();
    const inviteToken =
      request.headers.get("x-invite-token") ||
      body?.inviteToken ||
      body?.token ||
      null;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    if (!inviteToken || typeof inviteToken !== "string") {
      return NextResponse.json(
        {
          code: "INVITE_REQUIRED",
          message:
            "Sign-up requires a valid invitation. Please use your invite link or sign in with GitHub/Google.",
        },
        { status: 403 }
      );
    }

    // Check for a valid pending invitation for this email + token
    const pendingInvite = await db
      .select({ id: invitation.id, expiresAt: invitation.expiresAt })
      .from(invitation)
      .where(
        and(
          eq(invitation.id, inviteToken),
          eq(invitation.email, email),
          eq(invitation.status, "pending")
        )
      )
      .limit(1);

    if (pendingInvite.length === 0) {
      return NextResponse.json(
        { 
          code: "INVITE_REQUIRED",
          message: "Sign-up requires an invitation. Please contact your organization admin or use social sign-in (GitHub/Google)." 
        },
        { status: 403 }
      );
    }

    // Verify invitation hasn't expired
    const invite = pendingInvite[0];
    if (new Date() > invite.expiresAt) {
      return NextResponse.json(
        { 
          code: "INVITE_EXPIRED",
          message: "Your invitation has expired. Please ask your organization admin to send a new invitation." 
        },
        { status: 403 }
      );
    }

    // Valid invitation exists — proceed with Better Auth sign-up handler
    return betterAuthHandler.POST(request);
  } catch (error) {
    console.error("[Sign-up] Error checking invitation:", error);
    // On error, fail closed — do not allow sign-up without invitation verification
    return NextResponse.json(
      { error: "Unable to process sign-up at this time. Please try again." },
      { status: 500 }
    );
  }
}
