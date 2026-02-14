import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { invitation, organization, user as userTable } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { Role } from "@/lib/rbac/permissions";
import { logAuditEvent } from "@/lib/audit-logger";
import { EmailService } from "@/lib/email-service";
import { renderOrganizationInvitationEmail } from "@/lib/email-renderer";
import { getRedisConnection } from "@/lib/queue";

// Rate limiting for resend operations (more restrictive than invite creation)
const RESEND_RATE_LIMIT_KEY_PREFIX = "supercheck:invite:resend:ratelimit";
const RESEND_RATE_LIMIT_MAX = 5; // Max 5 resends per hour per user
const RESEND_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkResendRateLimit(userId: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      console.warn('[RESEND_RATE_LIMIT] Redis unavailable, allowing request');
      return { allowed: true };
    }

    const key = `${RESEND_RATE_LIMIT_KEY_PREFIX}:${userId}`;
    const now = Date.now();
    const windowStart = now - RESEND_RATE_LIMIT_WINDOW_MS;

    await redis.zremrangebyscore(key, 0, windowStart);
    const count = await redis.zcard(key);

    if (count >= RESEND_RATE_LIMIT_MAX) {
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      if (oldest.length >= 2) {
        const oldestScore = Number(oldest[1]);
        const retryAfter = Math.ceil((oldestScore + RESEND_RATE_LIMIT_WINDOW_MS - now) / 1000);
        return { allowed: false, retryAfter };
      }
      return { allowed: false, retryAfter: 3600 };
    }

    await redis.zadd(key, now, `${now}`);
    await redis.expire(key, Math.ceil(RESEND_RATE_LIMIT_WINDOW_MS / 1000));

    return { allowed: true };
  } catch (error) {
    console.error('[RESEND_RATE_LIMIT] Error checking rate limit:', error);
    return { allowed: true };
  }
}

/**
 * DELETE /api/organizations/members/invite/[invitationId]
 * Cancel a pending invitation.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ invitationId: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId, organizationId } = await requireUserAuthContext();

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    // Check if user is org admin
    const orgRole = await getUserOrgRole(userId, organizationId);
    const isOrgAdmin = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;

    if (!isOrgAdmin) {
      return NextResponse.json(
        { error: "Insufficient permissions to cancel invitations" },
        { status: 403 }
      );
    }

    // Find the invitation and verify it belongs to this organization
    const existingInvitation = await db
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        organizationId: invitation.organizationId,
      })
      .from(invitation)
      .where(
        and(
          eq(invitation.id, resolvedParams.invitationId),
          eq(invitation.organizationId, organizationId)
        )
      )
      .limit(1);

    if (existingInvitation.length === 0) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 }
      );
    }

    const invite = existingInvitation[0];

    if (invite.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending invitations can be cancelled" },
        { status: 400 }
      );
    }

    // Update status to cancelled
    await db
      .update(invitation)
      .set({ status: "cancelled" })
      .where(eq(invitation.id, resolvedParams.invitationId));

    // Log the audit event
    await logAuditEvent({
      userId,
      organizationId,
      action: "invitation_cancelled",
      resource: "invitation",
      resourceId: resolvedParams.invitationId,
      metadata: {
        cancelledEmail: invite.email,
        cancelledRole: invite.role,
      },
      success: true,
    });

    return NextResponse.json({
      success: true,
      message: "Invitation cancelled successfully",
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Authentication required",
        },
        { status: 401 }
      );
    }
    console.error("Error cancelling invitation:", error);
    return NextResponse.json(
      { error: "Failed to cancel invitation" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/organizations/members/invite/[invitationId]
 * Resend a pending invitation email.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invitationId: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId, organizationId } = await requireUserAuthContext();

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    // Check if user is org admin
    const orgRole = await getUserOrgRole(userId, organizationId);
    const isOrgAdmin = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;

    if (!isOrgAdmin) {
      return NextResponse.json(
        { error: "Insufficient permissions to resend invitations" },
        { status: 403 }
      );
    }

    // Rate limit resend operations
    const rateLimitResult = await checkResendRateLimit(userId);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: "Too many resend requests. Please try again later." },
        { 
          status: 429,
          headers: rateLimitResult.retryAfter 
            ? { 'Retry-After': String(rateLimitResult.retryAfter) }
            : undefined
        }
      );
    }

    // Find the invitation and verify it belongs to this organization
    const inviteDetails = await db
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        organizationId: invitation.organizationId,
        orgName: organization.name,
      })
      .from(invitation)
      .innerJoin(organization, eq(invitation.organizationId, organization.id))
      .where(
        and(
          eq(invitation.id, resolvedParams.invitationId),
          eq(invitation.organizationId, organizationId)
        )
      )
      .limit(1);

    if (inviteDetails.length === 0) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 }
      );
    }

    const invite = inviteDetails[0];

    if (invite.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending invitations can be resent" },
        { status: 400 }
      );
    }

    // Check if invitation is expired - if so, extend the expiry
    const now = new Date();
    const isExpired = now > invite.expiresAt;
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    if (isExpired) {
      // Extend the expiry date for expired invitations
      await db
        .update(invitation)
        .set({ expiresAt: newExpiresAt })
        .where(eq(invitation.id, resolvedParams.invitationId));
    }

    // Send email invitation
    const emailService = EmailService.getInstance();
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${invite.id}`;

    const emailContent = await renderOrganizationInvitationEmail({
      inviteUrl,
      organizationName: invite.orgName,
      role: invite.role ?? "member",
      projectInfo: "",
    });

    const emailResult = await emailService.sendEmail({
      to: invite.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    if (!emailResult.success) {
      console.error(
        `Failed to resend invitation email to ${invite.email}:`,
        emailResult.error
      );
      return NextResponse.json(
        { error: "Failed to send invitation email" },
        { status: 500 }
      );
    }

    // Log the audit event
    await logAuditEvent({
      userId,
      organizationId,
      action: "invitation_resent",
      resource: "invitation",
      resourceId: resolvedParams.invitationId,
      metadata: {
        resentToEmail: invite.email,
        role: invite.role,
        expiryExtended: isExpired,
        newExpiresAt: isExpired ? newExpiresAt.toISOString() : undefined,
      },
      success: true,
    });

    return NextResponse.json({
      success: true,
      message: `Invitation email resent to ${invite.email}`,
      data: {
        emailSent: true,
        expiryExtended: isExpired,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Authentication required",
        },
        { status: 401 }
      );
    }
    console.error("Error resending invitation:", error);
    return NextResponse.json(
      { error: "Failed to resend invitation" },
      { status: 500 }
    );
  }
}
