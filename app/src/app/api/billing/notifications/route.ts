import { NextResponse } from "next/server";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { usageNotificationService } from "@/lib/services/usage-notification.service";

/**
 * GET /api/billing/notifications
 * Get notification history for the active organization
 */
export async function GET(request: Request) {
  try {
    const { organizationId } = await requireUserAuthContext();

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

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
