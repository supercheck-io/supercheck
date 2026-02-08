import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  invitation,
  user as userTable,
  member,
  projects,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { Role } from "@/lib/rbac/permissions";
import { EmailService } from "@/lib/email-service";
import { inviteMemberSchema } from "@/lib/validations/member";
import { logAuditEvent } from "@/lib/audit-logger";
import { renderOrganizationInvitationEmail } from "@/lib/email-renderer";
import { checkTeamMemberLimit } from "@/lib/middleware/plan-enforcement";
import { getRedisConnection } from "@/lib/queue";

// Redis-based rate limiting for distributed/serverless environments
const INVITE_RATE_LIMIT_KEY_PREFIX = "supercheck:invite:ratelimit";
const INVITE_RATE_LIMIT_MAX = 10;
const INVITE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkInviteRateLimit(userId: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      // If Redis is unavailable, fail open but log a warning
      console.warn('[INVITE_RATE_LIMIT] Redis unavailable, allowing request');
      return { allowed: true };
    }

    const key = `${INVITE_RATE_LIMIT_KEY_PREFIX}:${userId}`;
    const now = Date.now();
    const windowStart = now - INVITE_RATE_LIMIT_WINDOW_MS;

    // Clean up old entries and count remaining
    await redis.zremrangebyscore(key, 0, windowStart);
    const count = await redis.zcard(key);

    if (count >= INVITE_RATE_LIMIT_MAX) {
      // Get the oldest entry to calculate retry-after
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      if (oldest.length >= 2) {
        const oldestScore = Number(oldest[1]);
        const retryAfter = Math.ceil((oldestScore + INVITE_RATE_LIMIT_WINDOW_MS - now) / 1000);
        return { allowed: false, retryAfter };
      }
      return { allowed: false, retryAfter: 3600 };
    }

    // Add current request
    await redis.zadd(key, now, `${now}`);
    await redis.expire(key, Math.ceil(INVITE_RATE_LIMIT_WINDOW_MS / 1000));

    return { allowed: true };
  } catch (error) {
    console.error('[INVITE_RATE_LIMIT] Error checking rate limit:', error);
    // Fail open on error but log
    return { allowed: true };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireUserAuthContext();

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    // Check rate limit using Redis
    const rateLimitResult = await checkInviteRateLimit(userId);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Maximum 10 invitations per hour." },
        { 
          status: 429,
          headers: rateLimitResult.retryAfter 
            ? { 'Retry-After': String(rateLimitResult.retryAfter) }
            : undefined
        }
      );
    }

    // Check if user is org admin
    const orgRole = await getUserOrgRole(userId, organizationId);
    const isOrgAdmin = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;

    if (!isOrgAdmin) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, role, selectedProjects } = body;

    // Validate request data using Zod schema
    try {
      inviteMemberSchema.parse({ email, role, selectedProjects });
    } catch (error) {
      if (error instanceof Error) {
        const zodError = error as { errors?: { message: string }[] };
        if (zodError.errors && zodError.errors.length > 0) {
          return NextResponse.json(
            { error: zodError.errors[0].message },
            { status: 400 }
          );
        }
      }
      return NextResponse.json(
        { error: "Invalid request data" },
        { status: 400 }
      );
    }

    // Check team member limit for the organization
    const currentMemberCount = await db
      .select({ count: member.userId })
      .from(member)
      .where(eq(member.organizationId, organizationId));

    const limitCheck = await checkTeamMemberLimit(organizationId, currentMemberCount.length);
    if (!limitCheck.allowed) {
      console.warn(`Team member limit reached for organization ${organizationId}: ${limitCheck.error}`);
      return NextResponse.json(
        { error: limitCheck.error },
        { status: 403 }
      );
    }

    // Check if user already exists and is a member
    const existingUser = await db
      .select({
        id: userTable.id,
        role: userTable.role,
        email: userTable.email,
      })
      .from(userTable)
      .where(eq(userTable.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      const user = existingUser[0];

      // Block cross-organization admin invitations
      // Check if user has admin privileges (system-wide or organization-level)
      const isSystemAdmin = user.role === "super_admin";

      // Check if they're an admin in any other organization
      const adminMemberships = await db
        .select({
          orgId: member.organizationId,
          role: member.role,
        })
        .from(member)
        .where(eq(member.userId, user.id));

      const hasAdminRole = adminMemberships.some(
        (m) => m.role === "org_owner" || m.role === "org_admin"
      );

      if (isSystemAdmin || hasAdminRole) {
        return NextResponse.json(
          {
            error:
              "Cannot invite users with administrative privileges from other organizations. Admins should manage their own organizations independently.",
          },
          { status: 400 }
        );
      }

      // Check if already a member of current organization
      const existingMember = await db
        .select({ id: member.userId })
        .from(member)
        .where(
          and(
            eq(member.userId, user.id),
            eq(member.organizationId, organizationId)
          )
        )
        .limit(1);

      if (existingMember.length > 0) {
        return NextResponse.json(
          { error: "User is already a member of this organization" },
          { status: 400 }
        );
      }
    }

    // Check for existing pending invitation
    const existingInvitation = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.email, email),
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, "pending")
        )
      )
      .limit(1);

    if (existingInvitation.length > 0) {
      return NextResponse.json(
        { error: "Invitation already sent to this email" },
        { status: 400 }
      );
    }

    // Create invitation
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    const [newInvitation] = await db
      .insert(invitation)
      .values({
        organizationId,
        email,
        role,
        status: "pending",
        expiresAt,
        inviterId: userId,
        selectedProjects: JSON.stringify(selectedProjects),
      })
      .returning();

    // Get selected projects info for the email
    const selectedProjectDetails = await db
      .select({
        id: projects.id,
        name: projects.name,
      })
      .from(projects)
      .where(
        and(
          inArray(projects.id, selectedProjects),
          eq(projects.status, "active")
        )
      );

    // Send email invitation
    const emailService = EmailService.getInstance();
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${newInvitation.id}`;

    let projectInfo = "";
    if (selectedProjectDetails.length > 0) {
      const projectNames = selectedProjectDetails.map((p) => p.name);
      if (projectNames.length === 1) {
        projectInfo = `You'll have access to the <strong>${projectNames[0]}</strong> project.`;
      } else {
        projectInfo = `You'll have access to the following projects: <strong>${projectNames.join(
          ", "
        )}</strong>.`;
      }
    }

    // Fetch org name for email
    const { organization } = await import("@/db/schema");
    const orgRecord = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: { name: true },
    });
    const orgName = orgRecord?.name ?? "Your Organization";

    // Render email using react-email template
    const emailContent = await renderOrganizationInvitationEmail({
      inviteUrl,
      organizationName: orgName,
      role,
      projectInfo,
    });

    const emailResult = await emailService.sendEmail({
      to: email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    if (!emailResult.success) {
      console.error(
        `Failed to send invitation email to ${email}:`,
        emailResult.error
      );
      // Still return success since the invitation was created, just log the email error
      console.log(
        `📧 Email failed, but invitation created. Manual link: ${inviteUrl}`
      );
    } else {
      console.log(
        `📧 Email invitation sent successfully to ${email} for organization ${orgName}`
      );
    }

    // Log the audit event for member invitation
    await logAuditEvent({
      userId,
      action: "member_invited",
      resource: "invitation",
      resourceId: newInvitation.id,
      metadata: {
        organizationId,
        invitedEmail: email,
        role: role,
        selectedProjectsCount: selectedProjects.length,
        selectedProjects: selectedProjectDetails.map((p) => ({
          id: p.id,
          name: p.name,
        })),
        organizationName: orgName,
        emailSent: emailResult.success,
        expiresAt: newInvitation.expiresAt?.toISOString(),
      },
      success: true,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: newInvitation.id,
        email: newInvitation.email,
        role: newInvitation.role,
        status: newInvitation.status,
        expiresAt: newInvitation.expiresAt,
        inviteLink: inviteUrl,
        emailSent: emailResult.success,
        emailError: emailResult.success ? undefined : emailResult.error,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error sending invitation:", error);
    return NextResponse.json(
      { error: "Failed to send invitation" },
      { status: 500 }
    );
  }
}
