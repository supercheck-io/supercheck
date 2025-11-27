import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/rbac/middleware";
import { getActiveOrganization } from "@/lib/session";
import { usageNotificationService } from "@/lib/services/usage-notification.service";

/**
 * GET /api/billing/notifications
 * Get notification history for the active organization
 */
export async function GET(request: Request) {
  try {
    await requireAuth();
    const activeOrg = await getActiveOrganization();

    if (!activeOrg) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const notifications = await usageNotificationService.getNotificationHistory(
      activeOrg.id,
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
    console.error("Error fetching notification history:", error);
    return NextResponse.json(
      { error: "Failed to fetch notification history" },
      { status: 500 }
    );
  }
}
