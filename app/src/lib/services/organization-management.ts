import { getCurrentUser } from "@/lib/session";
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
}

/** Compatibility endpoints must never create tenants or change billing context. */
export async function switchOrganization(_organizationId: string): Promise<never> {
  await requireOrganizationSession();
  throw new OrganizationManagementError("Organization switching is disabled. Use the project selector to switch projects.", 403);
}

export async function createOrganization(_name: string): Promise<never> {
  await requireOrganizationSession();
  throw new OrganizationManagementError("Your account already has a default organization. Create projects within it instead.", 403);
}
