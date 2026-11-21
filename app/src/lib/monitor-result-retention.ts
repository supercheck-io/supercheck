import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { organization, planLimits } from "@/db/schema";
import { isPolarEnabled } from "@/lib/feature-flags";
import { resolveRawRetention } from "@/lib/raw-retention";

/** How many days of raw check results the organization keeps, and whether the window comes from a paid plan. */
export interface RawResultRetention {
  days: number;
  onPlan: boolean;
}

/**
 * Raw monitor-result retention for one organization, by the same rule the cleanup sweep applies
 * (`resolveRawRetention`). Undefined when cleanup leaves the organization alone (cleanup off, a plan without a
 * row, a subscription whose plan is not set yet) or the lookup fails: the caller must not narrow the UI then.
 * Database only (no Polar call), and never throws.
 * Status-change rows (first failure, recovery) outlive the window; the window describes every other check.
 */
export async function getRawResultRetention(organizationId: string): Promise<RawResultRetention | undefined> {
  // Same switch and parsing as the cleanup sweep: with it off nothing is deleted.
  if (/^(false|0|no)$/.test((process.env.MONITOR_CLEANUP_ENABLED ?? "").trim().toLowerCase())) return undefined;
  try {
    const planDays = async (plan: "plus" | "pro" | "unlimited") =>
      (
        await db
          .select({ days: planLimits.dataRetentionDays })
          .from(planLimits)
          .where(eq(planLimits.plan, plan))
          .limit(1)
      )[0]?.days;

    let decision;
    if (!isPolarEnabled()) {
      decision = resolveRawRetention({ selfHosted: true, unlimitedDays: await planDays("unlimited") });
    } else {
      const org = await db.query.organization.findFirst({
        columns: { subscriptionPlan: true, subscriptionStatus: true },
        where: eq(organization.id, organizationId),
      });
      if (!org) return undefined;
      decision = resolveRawRetention({
        selfHosted: false,
        subscriptionPlan: org.subscriptionPlan,
        subscriptionStatus: org.subscriptionStatus,
        planDays: org.subscriptionPlan ? await planDays(org.subscriptionPlan) : undefined,
      });
    }
    return "skip" in decision ? undefined : decision;
  } catch {
    return undefined;
  }
}
