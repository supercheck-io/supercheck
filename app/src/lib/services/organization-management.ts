import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { member, organization, projects, projectMembers, session, user } from "@/db/schema";
import { isCloudHosted } from "@/lib/feature-flags";
import { getCurrentUser } from "@/lib/session";
import { clearRequestCache, getCachedAuthSession } from "@/lib/session-cache";
import { db } from "@/utils/db";
import { ensurePolarCustomerAndLink } from "./organization-customer";

export class OrganizationManagementError extends Error {
  constructor(message: string, readonly status: 401 | 403 | 409) {
    super(message);
  }
}

async function requireOrganizationSession() {
  const [currentUser, authSession] = await Promise.all([getCurrentUser(), getCachedAuthSession()]);
  if (!currentUser || !authSession?.session?.token) {
    throw new OrganizationManagementError("Authentication required", 401);
  }
  return { currentUser, token: authSession.session.token };
}

export async function switchOrganization(organizationId: string) {
  const { currentUser, token } = await requireOrganizationSession();
  const result = await db.transaction(async tx => {
    // Hold the membership while selecting and updating both session fields.
    const [membership] = await tx.select({ id: member.id }).from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, currentUser.id)))
      .limit(1).for("share");
    if (!membership) throw new OrganizationManagementError("Organization not found or access denied", 403);

    const [project] = await tx.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.status, "active")))
      .orderBy(desc(projects.isDefault), asc(projects.createdAt), asc(projects.id)).limit(1);
    const [updated] = await tx.update(session)
      .set({ activeOrganizationId: organizationId, activeProjectId: project?.id ?? null })
      .where(and(eq(session.token, token), eq(session.userId, currentUser.id)))
      .returning({ id: session.id });
    if (!updated) throw new OrganizationManagementError("Session changed. Please sign in again.", 401);
    return { organizationId, projectId: project?.id ?? null };
  });
  clearRequestCache();
  return result;
}

export async function createOrganization(name: string) {
  const { currentUser, token } = await requireOrganizationSession();
  const cloud = isCloudHosted();
  const result = await db.transaction(async tx => {
    // Serialize creation per owner so concurrent requests cannot exceed the cap.
    const [owner] = await tx.select({ emailVerified: user.emailVerified }).from(user)
      .where(eq(user.id, currentUser.id)).limit(1).for("update");
    if (!owner) throw new OrganizationManagementError("Authentication required", 401);
    if (cloud && !owner.emailVerified) {
      throw new OrganizationManagementError("Verify your email before creating an organization", 403);
    }
    if (cloud) {
      const configured = Number(process.env.MAX_ORGANIZATIONS_PER_USER ?? 5);
      const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 5;
      const owned = await tx.select({ id: member.id }).from(member)
        .where(and(eq(member.userId, currentUser.id), eq(member.role, "org_owner")));
      if (owned.length >= limit) {
        throw new OrganizationManagementError(`You can own up to ${limit} cloud organizations. Contact support if you need more.`, 409);
      }
    }
    const [created] = await tx.insert(organization).values({
      name, slug: randomUUID(), createdAt: new Date(),
      subscriptionPlan: cloud ? null : "unlimited",
      subscriptionStatus: cloud ? "none" : "active",
    }).returning({ id: organization.id, name: organization.name });
    await tx.insert(member).values({ organizationId: created.id, userId: currentUser.id, role: "org_owner", createdAt: new Date() });
    const [project] = await tx.insert(projects).values({
      organizationId: created.id, name: process.env.DEFAULT_PROJECT_NAME || "Default Project",
      slug: randomUUID(), isDefault: true, status: "active",
    }).returning({ id: projects.id });
    await tx.insert(projectMembers).values({ userId: currentUser.id, projectId: project.id, role: "project_editor", createdAt: new Date() });
    const [updated] = await tx.update(session)
      .set({ activeOrganizationId: created.id, activeProjectId: project.id })
      .where(and(eq(session.token, token), eq(session.userId, currentUser.id)))
      .returning({ id: session.id });
    if (!updated) throw new OrganizationManagementError("Session changed. Please sign in again.", 401);
    return { ...created, projectId: project.id };
  });
  clearRequestCache();
  // Keep external requests outside the transaction. Checkout can retry a failed
  // customer setup without creating another organization or transferring a plan.
  if (cloud) {
    await ensurePolarCustomerAndLink(currentUser.id, currentUser.email, currentUser.name, result.id);
  }
  return result;
}
