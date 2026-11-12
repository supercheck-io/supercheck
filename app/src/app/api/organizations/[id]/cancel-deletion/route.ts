import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/uuid";
import { requireUserAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { getUserOrgRole, isImpersonatedSession } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { OrganizationDeletionError, cancelOrganizationDeletion } from "@/lib/deletion/organization";

/**
 * POST /api/organizations/[id]/cancel-deletion
 * Owner cancels a pending deletion during the window. 409 PURGE_STARTED once the window is over.
 * Response: { success, billing: "reinstated" | "ended" | "skipped" | "none" | "failed" } ("ended": the paid period already finished, resubscribe; "failed": the organization is restored but renewal could not be re-enabled, use the billing portal).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });
    const originError = requireSameOriginRequest(request, { allowMissing: isCliAuth });
    if (originError) return originError;
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    const role = await getUserOrgRole(userId, id);
    if (!role) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    if (role !== Role.ORG_OWNER) return NextResponse.json({ error: "Only organization owners can cancel the deletion" }, { status: 403 });
    if (await isImpersonatedSession()) return NextResponse.json({ error: "Stop impersonating before changing the deletion" }, { status: 403 });
    const result = await cancelOrganizationDeletion({ organizationId: id, actorUserId: userId });
    return NextResponse.json({ success: true, billing: result.billing });
  } catch (error) {
    if (error instanceof OrganizationDeletionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (isAuthError(error)) return NextResponse.json({ error: error instanceof Error ? error.message : "Authentication required" }, { status: authErrorStatus(error) });
    console.error("Failed to cancel organization deletion:", error);
    return NextResponse.json({ error: "Failed to cancel organization deletion" }, { status: 500 });
  }
}
