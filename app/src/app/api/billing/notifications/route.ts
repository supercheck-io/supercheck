import { NextResponse } from "next/server";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { usageNotificationService } from "@/lib/services/usage-notification.service";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";

/**
 * GET /api/billing/notifications
 * Get notification history for the active organization
 */
export async function GET(request: Request) {
  try {
    const { userId, organizationId } = await requireUserAuthContext();

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    const role = await getUserOrgRole(userId, organizationId);
    if (role !== Role.ORG_OWNER && role !== Role.ORG_ADMIN) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
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

    const notifications = await usageNotificationService.getNotificationHistory(
      organizationId,
      { limit, offset }
    );

    return NextResponse.json({
      notifications,
      pagination: {
        limit,
        offset,
        hasMore: notifications.length === limit,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error fetching notification history:", error);
    return NextResponse.json(
      { error: "Failed to fetch notification history" },
      { status: 500 }
    );
  }
}
