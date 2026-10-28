import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/utils/db";
import { member, projects, projectMembers, session } from "@/db/schema";
import { requireUserAuthContext } from "@/lib/auth-context";
import { clearRequestCache } from "@/lib/session-cache";
import { logAuditEvent } from "@/lib/audit-logger";
import { disableTriggerKeysForMember } from "@/lib/security/disable-trigger-keys";

export class LeaveOrganizationError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409) {
    super(message);
  }
}

/** Leave only the browser session's active organization, never a caller-selected tenant. */
export async function leaveOrganization(expectedOrganizationId: string) {
  const { userId, organizationId, isCliAuth } = await requireUserAuthContext();
  if (isCliAuth) {
    throw new LeaveOrganizationError("Leaving an organization requires an interactive browser session", 403);
  }
  if (!organizationId) throw new LeaveOrganizationError("No active organization found", 400);

  if (organizationId !== expectedOrganizationId) {
    throw new LeaveOrganizationError("Your active organization changed. Reload before leaving.", 409);
  }

  await db.transaction(async (tx) => {
    // Lock the membership so a simultaneous owner promotion cannot race this check.
    const [membership] = await tx.select({ id: member.id, role: member.role })
      .from(member).where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .for("update");
    if (!membership) throw new LeaveOrganizationError("Organization membership not found", 404);
    if (membership.role === "org_owner") {
      throw new LeaveOrganizationError("Organization owners must transfer ownership or delete the organization before leaving", 403);
    }
    const orgProjects = await tx.select({ id: projects.id }).from(projects)
      .where(eq(projects.organizationId, organizationId));
    const projectIds = orgProjects.map(project => project.id);
    if (projectIds.length) {
      await tx.delete(projectMembers).where(and(
        eq(projectMembers.userId, userId), inArray(projectMembers.projectId, projectIds),
      ));
    }
    await tx.delete(member).where(eq(member.id, membership.id));
    // Clear every affected session, including legacy sessions with only a project selected.
    await tx.update(session).set({ activeOrganizationId: null, activeProjectId: null, updatedAt: new Date() })
      .where(and(eq(session.userId, userId), or(
        eq(session.activeOrganizationId, organizationId),
        ...(projectIds.length ? [inArray(session.activeProjectId, projectIds)] : []),
      )));
    await disableTriggerKeysForMember(tx, userId, organizationId);
    await logAuditEvent({
      userId, organizationId, action: "member_left", resource: "member", resourceId: userId, success: true,
    }, tx, { strict: true });
  });
  clearRequestCache();
  // The normal setup flow selects a remaining organization or creates personal defaults.
  return { organizationId };
}
