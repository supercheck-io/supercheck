import { NextResponse } from "next/server";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";
import { polarUsageService } from "@/lib/services/polar-usage.service";

/**
 * GET /api/billing/usage
 * Get detailed usage metrics for the active organization
 */
export async function GET() {
  try {
    const { userId, organizationId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    // Subscription, spending and usage figures are for org admins and owners only.
    const orgRole = await getUserOrgRole(userId, organizationId);
    if (orgRole !== Role.ORG_ADMIN && orgRole !== Role.ORG_OWNER) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const metrics = await polarUsageService.getUsageMetrics(organizationId);
    const spendingStatus = await polarUsageService.getSpendingStatus(organizationId);

    return NextResponse.json({
      organizationId,
      usage: metrics,
      spending: {
        currentDollars: spendingStatus.currentSpendingCents / 100,
        limitDollars:
          spendingStatus.limitCents !== null
            ? spendingStatus.limitCents / 100
            : null,
        limitEnabled: spendingStatus.limitEnabled,
        hardStopEnabled: spendingStatus.hardStopEnabled,
        percentageUsed: spendingStatus.percentageUsed,
        isAtLimit: spendingStatus.isAtLimit,
        remainingDollars:
          spendingStatus.remainingCents !== null
            ? spendingStatus.remainingCents / 100
            : null,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error fetching usage metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage metrics" },
      { status: 500 }
    );
  }
}
