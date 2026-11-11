import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/uuid";
import { requireUserAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { getOrganizationDeletionState } from "@/lib/deletion/organization";
import { reauthMaxAgeSeconds } from "@/lib/deletion/reauth";

/**
 * GET /api/organizations/[id]/deletion
 * Deletion state for the banner and the delete dialog. Any member may read it.
 * { pending, requestedAt, purgeAfter, canCancel, purge, graceDays, emailAvailable, selfHosted, hasSubscription, reauthMaxAgeSeconds }
 * `emailAvailable: false` means no mail is sent (no SMTP), so the UI confirms in the app only.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    const role = await getUserOrgRole(userId, id);
    if (!role) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    const state = await getOrganizationDeletionState(id);
    if (!state) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    // Raw purge errors can carry internal detail: owners only (super admins read them in the admin view).
    const purge = state.purge && role !== "org_owner" ? { ...state.purge, lastError: state.purge.lastError ? "Purge is retrying" : null } : state.purge;
    return NextResponse.json({ success: true, deletion: { ...state, purge, reauthMaxAgeSeconds: reauthMaxAgeSeconds() } });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ error: error instanceof Error ? error.message : "Authentication required" }, { status: authErrorStatus(error) });
    console.error("Failed to read organization deletion state:", error);
    return NextResponse.json({ error: "Failed to read deletion state" }, { status: 500 });
  }
}
