import { NextResponse } from "next/server";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { db } from "@/utils/db";
import { organization } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isCloudHosted } from "@/lib/feature-flags";

/**
 * GET /api/subscription/status
 * Lightweight endpoint that returns only the subscription active status and plan.
 * Used by SubscriptionGuard on page load — much faster than /api/billing/current
 * which fetches full usage, limits, and resource counts.
 */
export async function GET() {
  try {
    const { organizationId } = await requireUserAuthContext();

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    // Self-hosted: always active with unlimited plan
    if (!isCloudHosted()) {
      return NextResponse.json({
        isActive: true,
        plan: "unlimited",
      });
    }

    // Cloud mode: check org subscription fields (single query)
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: {
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
      },
    });

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Cloud mode: only plus/pro are valid active plans
    const hasValidPlan =
      org.subscriptionPlan === "plus" || org.subscriptionPlan === "pro";

    // Determine if subscription is active, including grace period for canceled
    // and past_due (Polar retries payment automatically)
    let isActive = false;
    if (hasValidPlan) {
      switch (org.subscriptionStatus) {
        case "active":
        case "past_due":
          isActive = true;
          break;
        case "canceled":
          // Canceled subscriptions retain access until the billing period ends
          if (org.subscriptionEndsAt) {
            isActive = new Date() < new Date(org.subscriptionEndsAt);
          }
          break;
        default:
          isActive = false;
      }
    }

    return NextResponse.json({
      isActive,
      plan: hasValidPlan ? org.subscriptionPlan : null,
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
