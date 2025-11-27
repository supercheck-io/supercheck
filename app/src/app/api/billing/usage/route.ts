import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/rbac/middleware";
import { getActiveOrganization } from "@/lib/session";
import { polarUsageService } from "@/lib/services/polar-usage.service";

/**
 * GET /api/billing/usage
 * Get detailed usage metrics for the active organization
 */
export async function GET() {
  try {
    await requireAuth();
    const activeOrg = await getActiveOrganization();

    if (!activeOrg) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    const metrics = await polarUsageService.getUsageMetrics(activeOrg.id);
    const spendingStatus = await polarUsageService.getSpendingStatus(activeOrg.id);

    return NextResponse.json({
      usage: metrics,
      spending: {
        currentDollars: spendingStatus.currentSpendingCents / 100,
        limitDollars: spendingStatus.limitCents ? spendingStatus.limitCents / 100 : null,
        limitEnabled: spendingStatus.limitEnabled,
        hardStopEnabled: spendingStatus.hardStopEnabled,
        percentageUsed: spendingStatus.percentageUsed,
        isAtLimit: spendingStatus.isAtLimit,
        remainingDollars: spendingStatus.remainingCents ? spendingStatus.remainingCents / 100 : null,
      },
    });
  } catch (error) {
    console.error("Error fetching usage metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage metrics" },
      { status: 500 }
    );
  }
}
