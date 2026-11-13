import { NextResponse } from "next/server";
import { requireUserAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";
import { listDeletedProjects } from "@/lib/deletion/project";

/** GET /api/projects/deleted: soft-deleted projects of the active organization still restorable (owners and admins). */
export async function GET() {
  try {
    const { userId, organizationId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });
    if (!organizationId) return NextResponse.json({ error: "No active organization found" }, { status: 400 });
    const role = await getUserOrgRole(userId, organizationId);
    if (role !== Role.ORG_OWNER && role !== Role.ORG_ADMIN) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    return NextResponse.json({ success: true, projects: await listDeletedProjects(organizationId) });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ error: error instanceof Error ? error.message : "Authentication required" }, { status: authErrorStatus(error) });
    console.error("Failed to list deleted projects:", error);
    return NextResponse.json({ error: "Failed to list deleted projects" }, { status: 500 });
  }
}
