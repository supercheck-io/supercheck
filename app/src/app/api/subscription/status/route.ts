import { NextRequest, NextResponse } from "next/server";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { subscriptionService } from "@/lib/services/subscription-service";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { z } from "zod";

/**
 * GET /api/subscription/status
 * Lightweight endpoint that returns only the subscription active status and plan.
 * Used by SubscriptionGuard on page load — much faster than /api/billing/current
 * which fetches full usage, limits, and resource counts.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireUserAuthContext();
    let organizationId = context.organizationId;
    const requestedId = request.nextUrl.searchParams.get("organizationId");
    if (requestedId !== null) {
      if (!z.string().uuid().safeParse(requestedId).success) {
        return NextResponse.json({ error: "Invalid organization ID" }, { status: 400 });
      }
      if (context.isCliAuth || !await getUserOrgRole(context.userId, requestedId)) {
        return NextResponse.json({ error: "Organization not found or access denied" }, { status: 403 });
      }
      organizationId = requestedId;
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    const access = await subscriptionService.getSubscriptionAccessStatus(
      organizationId
    );

    if (access.reason === "organization_not_found") {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      organizationId,
      isActive: access.isActive,
      plan: access.plan,
      status: access.status,
      reason: access.reason,
      subscriptionEndsAt: access.subscriptionEndsAt,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Authentication required",
        },
        { status: 401 }
      );
    }
    console.error("Error fetching subscription status:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscription status" },
      { status: 500 }
    );
  }
}
