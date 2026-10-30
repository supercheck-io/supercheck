import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/utils/db";
import { invitation, user as userTable, member, projects } from "@/db/schema";
import { eq, and, inArray, sql, gte } from "drizzle-orm";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { Role } from "@/lib/rbac/permissions";
import { buildInvitationProjectInfo } from "@/lib/invitation-project-info";
import { EmailService } from "@/lib/email-service";
import { inviteMemberSchema } from "@/lib/validations/member";
import { logAuditEvent } from "@/lib/audit-logger";
import { renderOrganizationInvitationEmail } from "@/lib/email-renderer";
import { checkTeamMemberLimit } from "@/lib/middleware/plan-enforcement";
import { insertWithinPlanLimit } from "@/lib/middleware/plan-limit-lock";
import { getRedisConnection } from "@/lib/queue";

// Redis-based rate limiting for distributed/serverless environments
const INVITE_RATE_LIMIT_KEY_PREFIX = "supercheck:invite:ratelimit";
const configuredInviteRateLimitMax = Number.parseInt(
  process.env.INVITE_RATE_LIMIT_MAX ?? "10",
  10,
);
const INVITE_RATE_LIMIT_MAX =
  Number.isSafeInteger(configuredInviteRateLimitMax) &&
  configuredInviteRateLimitMax > 0
    ? configuredInviteRateLimitMax
    : 10;
const INVITE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

type InviteReservation = { key: string; token: string };

async function checkInviteRateLimit(
  userId: string,
): Promise<{
  allowed: boolean;
  retryAfter?: number;
  reservation?: InviteReservation;
}> {
  try {
    const redis = await getRedisConnection();
    if (!redis) {
      console.warn("[INVITE_RATE_LIMIT] Redis unavailable, allowing request");
      return { allowed: true };
    }
    const reservation = {
      key: `${INVITE_RATE_LIMIT_KEY_PREFIX}:${userId}`,
      token: randomUUID(),
    };
    const retryMs = Number(
      await redis.eval(
        `
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
      if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
        local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
        return math.max(1, tonumber(oldest[2]) + window - now)
      end
      redis.call('ZADD', KEYS[1], now, ARGV[4])
      redis.call('PEXPIRE', KEYS[1], window)
      return 0
    `,
        1,
        reservation.key,
        Date.now(),
        INVITE_RATE_LIMIT_WINDOW_MS,
        INVITE_RATE_LIMIT_MAX,
        reservation.token,
      ),
    );
    return retryMs > 0
      ? { allowed: false, retryAfter: Math.ceil(retryMs / 1000) }
      : { allowed: true, reservation };
  } catch (error) {
    console.error("[INVITE_RATE_LIMIT] Error checking rate limit:", error);
    // Preserve existing fail-open behavior when Redis is unavailable.
    return { allowed: true };
  }
}

async function releaseInviteReservation(reservation: InviteReservation) {
  try {
    const redis = await getRedisConnection();
    await redis?.zrem(reservation.key, reservation.token);
  } catch (error) {
    console.error(
      "[INVITE_RATE_LIMIT] Error releasing rejected invitation quota:",
      error,
    );
  }
}

export async function POST(request: NextRequest) {
  let reservation: InviteReservation | undefined;
  let invitationCreated = false;
  try {
    const { userId, organizationId, isCliAuth } =
      await requireUserAuthContext();
    if (isCliAuth) {
      return NextResponse.json(
        {
          error:
            "Organization administration requires an interactive browser session; CLI tokens are project-scoped",
        },
        { status: 403 },
      );
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 },
      );
    }

    // Check if user is org admin
    const orgRole = await getUserOrgRole(userId, organizationId);
    const isOrgAdmin = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;

    if (!isOrgAdmin) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }
    const { email, role, selectedProjects } = body;
    const normalizedEmail =
      typeof email === "string" ? email.toLowerCase().trim() : "";
    const normalizedSelectedProjects = Array.isArray(selectedProjects)
      ? Array.from(
          new Set(
            selectedProjects
              .filter(
                (projectId: unknown): projectId is string =>
                  typeof projectId === "string",
              )
              .map((projectId: string) => projectId.trim())
              .filter((projectId: string) => projectId.length > 0),
          ),
        )
      : [];

    // Only organization owners can invite org_admin members.
    // Keep invite permissions aligned with role update permissions.
    if (role === "org_admin" && orgRole !== Role.ORG_OWNER) {
      return NextResponse.json(
        { error: "Only organization owners can invite org_admin members" },
        { status: 403 },
      );
    }

    // Validate request data using Zod schema
    try {
      inviteMemberSchema.parse({
        email: normalizedEmail,
        role,
        selectedProjects: normalizedSelectedProjects,
      });
    } catch (error) {
      if (error instanceof Error) {
        const zodError = error as { issues?: { message: string }[] };
        if (zodError.issues && zodError.issues.length > 0) {
          return NextResponse.json(
            { error: zodError.issues[0].message },
            { status: 400 },
          );
        }
      }
      return NextResponse.json(
        { error: "Invalid request data" },
        { status: 400 },
      );
    }

    const roleRequiresProjectAssignments =
      role === "project_admin" || role === "project_editor";
    const selectedProjectsForRole = roleRequiresProjectAssignments
      ? normalizedSelectedProjects
      : [];

    // Check if user already exists and is a member
    const existingUser = await db
      .select({
        id: userTable.id,
        role: userTable.role,
        email: userTable.email,
      })
      .from(userTable)
      .where(sql`LOWER(${userTable.email}) = ${normalizedEmail}`)
      .limit(1);

    if (existingUser.length > 0) {
      const user = existingUser[0];

      // Owning an account organization does not prevent joining another team's
      // projects. The invitation grants only its explicit role in the target team.
      if (user.role === "super_admin") {
        return NextResponse.json(
          { error: "System administrators cannot be invited as team members" },
          { status: 400 },
        );
      }

      // Check if already a member of current organization
      const existingMember = await db
        .select({ id: member.userId })
        .from(member)
        .where(
          and(
            eq(member.userId, user.id),
            eq(member.organizationId, organizationId),
          ),
        )
        .limit(1);

      if (existingMember.length > 0) {
        return NextResponse.json(
          { error: "User is already a member of this organization" },
          { status: 400 },
        );
      }
    }

    // Check for existing pending invitation
    const existingInvitation = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          sql`LOWER(${invitation.email}) = ${normalizedEmail}`,
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, "pending"),
          gte(invitation.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (existingInvitation.length > 0) {
      return NextResponse.json(
        { error: "Invitation already sent to this email" },
        { status: 400 },
      );
    }

    // SECURITY: Validate selected projects belong to this organization BEFORE creating invitation
    let selectedProjectDetails: { id: string; name: string }[] = [];
    if (selectedProjectsForRole.length > 0) {
      selectedProjectDetails = await db
        .select({
          id: projects.id,
          name: projects.name,
        })
        .from(projects)
        .where(
          and(
            inArray(projects.id, selectedProjectsForRole),
            eq(projects.status, "active"),
            eq(projects.organizationId, organizationId),
          ),
        );

      if (selectedProjectDetails.length !== selectedProjectsForRole.length) {
        return NextResponse.json(
          {
            error:
              "One or more selected projects do not belong to this organization",
          },
          { status: 400 },
        );
      }
    }

    // Reserve quota only after authorization, request, duplicate, and project validation.
    const rateLimitResult = await checkInviteRateLimit(userId);
    reservation = rateLimitResult.reservation;
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded. Maximum ${INVITE_RATE_LIMIT_MAX} invitations per hour.`,
        },
        {
          status: 429,
          headers: rateLimitResult.retryAfter
            ? { "Retry-After": String(rateLimitResult.retryAfter) }
            : undefined,
        },
      );
    }

    // Create invitation
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    // Pending invitations reserve a seat: accepting one adds a member without
    // re-checking the limit, so seats are counted at invite time. The lock keeps
    // concurrent invites from all passing the same count.
    const invited = await insertWithinPlanLimit({
      organizationId,
      resource: "members",
      check: checkTeamMemberLimit,
      countRows: async (tx) => {
        const [memberRow] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(member)
          .where(eq(member.organizationId, organizationId));
        const [pendingRow] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, organizationId),
              eq(invitation.status, "pending"),
              gte(invitation.expiresAt, new Date()),
            ),
          );
        return Number(memberRow?.count || 0) + Number(pendingRow?.count || 0);
      },
      insert: async (executor) => {
        const [created] = await executor
          .insert(invitation)
          .values({
            organizationId,
            email: normalizedEmail,
            role,
            status: "pending",
            expiresAt,
            inviterId: userId,
            selectedProjects: selectedProjectsForRole,
          })
          .returning();
        return created;
      },
    });

    if (!invited.ok && invited.busy) {
      return NextResponse.json(
        { error: "Too many concurrent requests. Please retry shortly." },
        { status: 503, headers: { "Retry-After": "2" } },
      );
    }
    if (!invited.ok) {
      console.warn(
        `Team member limit reached for organization ${organizationId}: ${invited.check.error}`,
      );
      return NextResponse.json({ error: invited.check.error }, { status: 403 });
    }
    const newInvitation = invited.row;
    invitationCreated = true;

    // Send email invitation
    const emailService = EmailService.getInstance();
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${newInvitation.id}`;

    const projectInfo = buildInvitationProjectInfo(role, selectedProjectDetails.map((p) => p.name));

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
      to: normalizedEmail,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    if (!emailResult.success) {
      console.error(
        "Failed to send invitation email to %s:",
        normalizedEmail,
        emailResult.error,
      );
      // Still return success since the invitation was created, just log the email error
      console.log(
        "Email failed, but invitation created. Manual link: %s",
        inviteUrl,
      );
    } else {
      console.log(
        "Email invitation sent successfully to %s for organization %s",
        normalizedEmail,
        orgName,
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
        invitedEmail: normalizedEmail,
        role: role,
        selectedProjectsCount: selectedProjectsForRole.length,
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
        {
          error:
            error instanceof Error ? error.message : "Authentication required",
        },
        { status: 401 },
      );
    }
    console.error("Error sending invitation:", error);
    return NextResponse.json(
      { error: "Failed to send invitation" },
      { status: 500 },
    );
  } finally {
    if (reservation && !invitationCreated)
      await releaseInviteReservation(reservation);
  }
}
