import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { organization, planLimits } from "@/db/schema";
import { isPolarEnabled } from "@/lib/feature-flags";
import { subscriptionService } from "@/lib/services/subscription-service";
import { getActiveTrial, TRIAL_RETENTION } from "@/lib/execution/trial-limits";

/** How many days of raw check results the organization keeps, and whether billing (plans) is on. */
export interface RawResultRetention {
  days: number;
  onPlan: boolean;
}

/**
 * Raw monitor-result retention for one organization, resolved the way the cleanup sweep resolves it
 * (`getOrganizationRetentionSettings`): self-hosted reads the `unlimited` row, a plan reads its row, a free
 * trial (no billing history) gets the trial window. Anything else is unknown: cleanup then uses its own
 * fallback, so the caller must not narrow the UI. Database only (no Polar call), and never throws.
 * Status-change rows (first failure, recovery) outlive the window; the window describes every other check.
 */
export async function getRawResultRetention(organizationId: string): Promise<RawResultRetention | undefined> {
  // Same switch and parsing as the cleanup sweep: with it off nothing is deleted.
  if (/^(false|0|no)$/.test((process.env.MONITOR_CLEANUP_ENABLED ?? "").trim().toLowerCase())) return undefined;
  try {
    if (!isPolarEnabled()) {
      // The row itself, as cleanup reads it: no row means cleanup's own fallback, so unknown here.
      const [row] = await db
        .select({ days: planLimits.dataRetentionDays })
        .from(planLimits)
        .where(eq(planLimits.plan, "unlimited"))
        .limit(1);
      return row && row.days > 0 ? { days: row.days, onPlan: false } : undefined;
    }

    const org = await db.query.organization.findFirst({
      columns: { subscriptionPlan: true, subscriptionStatus: true },
      where: eq(organization.id, organizationId),
    });
    if (!org) return undefined;

    if (org.subscriptionPlan === "plus" || org.subscriptionPlan === "pro") {
      const days = (await subscriptionService.getPlanLimits(org.subscriptionPlan)).dataRetentionDays;
      return days > 0 ? { days, onPlan: true } : undefined;
    }

    if (!org.subscriptionPlan && !org.subscriptionStatus && (await getActiveTrial(organizationId))) {
      return { days: TRIAL_RETENTION.dataRetentionDays, onPlan: true };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
