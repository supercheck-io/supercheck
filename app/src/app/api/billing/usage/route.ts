import { NextResponse } from "next/server";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { polarUsageService } from "@/lib/services/polar-usage.service";

/**
 * GET /api/billing/usage
 * Get detailed usage metrics for the active organization
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

    const metrics = await polarUsageService.getUsageMetrics(organizationId);
    const spendingStatus = await polarUsageService.getSpendingStatus(organizationId);

    return NextResponse.json({
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
