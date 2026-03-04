import { auth } from "@/utils/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { invitation } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { isSelfHosted, isSignupEnabled, isEmailDomainAllowed } from "@/lib/feature-flags";

const betterAuthHandler = toNextJsHandler(auth);

export const GET = betterAuthHandler.GET;

type InvitationValidationResult =
  | { valid: true }
  | { valid: false; code: "INVITE_REQUIRED" | "INVITE_EXPIRED"; message: string };

async function validatePendingInvitation(
  email: string,
  inviteToken: string,
): Promise<InvitationValidationResult> {
  const pendingInvite = await db
    .select({ id: invitation.id, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(
      and(
        eq(invitation.id, inviteToken),
        sql`LOWER(${invitation.email}) = ${email}`,
        eq(invitation.status, "pending")
      )
    )
    .limit(1);

  if (pendingInvite.length === 0) {
    return {
      valid: false,
      code: "INVITE_REQUIRED",
      message:
        "Sign-up requires an invitation. Please contact your organization admin or use social sign-in (GitHub/Google).",
    };
  }

  const invite = pendingInvite[0];
  if (new Date() > invite.expiresAt) {
    return {
      valid: false,
      code: "INVITE_EXPIRED",
      message:
        "Your invitation has expired. Please ask your organization admin to send a new invitation.",
    };
  }

  return { valid: true };
}

/**
 * POST /api/auth/sign-up/email
 * 
 * Cloud mode: Email/password sign-up is INVITE-ONLY.
 *   Users must have a valid pending invitation to register with email/password.
 *   This is enforced at the API boundary (not just UI redirects).
 *
 * Self-hosted mode: Open registration.
 *   Anyone can create an account with email/password without an invitation.
 *   This enables deployments behind corporate proxies where OAuth is unavailable.
 *
 * Registration controls (both modes):
 *   SIGNUP_ENABLED=false       → Blocks ALL new sign-ups (invitations still work)
 *   ALLOWED_EMAIL_DOMAINS=...  → Only emails from listed domains can register
 */
export async function POST(request: NextRequest) {
  // Clone the request so we can read the body without consuming it
  const clonedRequest = request.clone();
  let body: Record<string, unknown>;
  try {
    body = await clonedRequest.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const email = (body?.email as string)?.toLowerCase()?.trim();
  const inviteTokenRaw =
    request.headers.get("x-invite-token") ||
    (body?.inviteToken as string) ||
    (body?.token as string) ||
    null;
  const inviteToken =
    typeof inviteTokenRaw === "string" && inviteTokenRaw.trim().length > 0
      ? inviteTokenRaw.trim()
      : null;

  if (!email) {
    return NextResponse.json(
      { error: "Email is required" },
      { status: 400 }
    );
  }

  // ── Registration controls (apply in both self-hosted and cloud modes) ──

  const selfHosted = isSelfHosted();

  // SIGNUP_ENABLED is the master gate: check it first so a globally-disabled
  // deployment does not reveal domain-restriction configuration to callers.
  // When disabled, only users with a valid pending invite can register.
  if (!isSignupEnabled()) {
    if (!inviteToken) {
      return NextResponse.json(
        {
          code: "SIGNUP_DISABLED",
          message: "New account registration is currently disabled. Please contact your administrator.",
        },
        { status: 403 }
      );
    }

    const inviteValidation = await validatePendingInvitation(email, inviteToken);
    if (!inviteValidation.valid) {
      return NextResponse.json(
        {
          code: inviteValidation.code,
          message: inviteValidation.message,
        },
        { status: 403 }
      );
    }
  }

  // Check email domain restriction (applies to all registrations, including invited users).
  if (!isEmailDomainAllowed(email)) {
    return NextResponse.json(
      {
        code: "EMAIL_DOMAIN_NOT_ALLOWED",
        message: "Registration is restricted to specific email domains. Please use an allowed email address.",
      },
      { status: 403 }
    );
  }

  // Self-hosted mode: allow open registration without invitation
  if (selfHosted) {
    return betterAuthHandler.POST(request);
  }

  // Cloud mode: enforce invite-only sign-up
  try {

    if (!inviteToken) {
      return NextResponse.json(
        {
          code: "INVITE_REQUIRED",
          message:
            "Sign-up requires a valid invitation. Please use your invite link or sign in with GitHub/Google.",
        },
        { status: 403 }
      );
    }

    const inviteValidation = await validatePendingInvitation(email, inviteToken);
    if (!inviteValidation.valid) {
      return NextResponse.json(
        {
          code: inviteValidation.code,
          message: inviteValidation.message,
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
