import { and, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { session } from "@/db/schema";
import { getCurrentUser, getSelectableOrganizations } from "@/lib/session";
import { getCachedAuthSession } from "@/lib/session-cache";

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
  return { currentUser, authSession };
}

export async function switchOrganization(organizationId: string): Promise<{ organizationId: string }> {
  const { currentUser, authSession } = await requireOrganizationSession();
  const organizations = await getSelectableOrganizations(currentUser.id);
  if (!organizations.some(org => org.id === organizationId)) {
    throw new OrganizationManagementError("Organization not found or access denied", 403);
  }
  const updated = await db.update(session)
    .set({ activeOrganizationId: organizationId, activeProjectId: null })
    .where(and(eq(session.token, authSession.session.token), eq(session.userId, currentUser.id)))
    .returning({ activeOrganizationId: session.activeOrganizationId });
  if (!updated.length) throw new OrganizationManagementError("Authentication required", 401);
  return { organizationId };
}

export async function createOrganization(_name: string): Promise<never> {
  await requireOrganizationSession();
  throw new OrganizationManagementError("Your account already has a default organization. Create projects within it instead.", 403);
}
