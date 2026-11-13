import { NextResponse } from "next/server";
import { requireUserAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { usageNotificationService } from "@/lib/services/usage-notification.service";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";

/**
 * GET /api/billing/notifications
 * Get notification history for the active organization
 */
export async function GET(request: Request) {
  try {
    const { userId, organizationId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) {
      return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    const role = await getUserOrgRole(userId, organizationId);
    if (role !== Role.ORG_OWNER && role !== Role.ORG_ADMIN) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const requestedLimit = Number.parseInt(searchParams.get("limit") || "50", 10);
    const requestedOffset = Number.parseInt(searchParams.get("offset") || "0", 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 50;
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, requestedOffset)
      : 0;

    // One extra row tells a full last page from a further page.
    const rows = await usageNotificationService.getNotificationHistory(
      organizationId,
      { limit: limit + 1, offset }
    );

    return NextResponse.json({
      notifications: rows.slice(0, limit),
      pagination: {
        limit,
        offset,
        hasMore: rows.length > limit,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: authErrorStatus(error) }
      );
    }
    console.error("Error fetching notification history:", error);
    return NextResponse.json(
      { error: "Failed to fetch notification history" },
      { status: 500 }
    );
  }
}
