import { and, eq, sql } from "drizzle-orm";

import { organization, usageEvents } from "@/db/schema";
import { isPolarEnabled } from "@/lib/feature-flags";
import { polarUsageService } from "@/lib/services/polar-usage.service";
import { subscriptionService } from "@/lib/services/subscription-service";
import { db } from "@/utils/db";

const SRE_INVESTIGATION_UNITS_PER_RUN = "1.0000";

export class SreInvestigationBillingError extends Error {
  constructor(message: string, readonly code: "spending_limit" | "subscription_required" | "organization_not_found") {
    super(message);
    this.name = "SreInvestigationBillingError";
  }
}

function defaultPeriodEnd(now: Date) {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

export async function assertCanStartSreInvestigation(organizationId: string) {
  if (!isPolarEnabled()) {
    return { billable: false as const };
  }

  const hasSubscription = await subscriptionService.hasActiveSubscription(organizationId);
  if (!hasSubscription) {
    throw new SreInvestigationBillingError("Active subscription required to run SRE investigations", "subscription_required");
  }

  const spending = await polarUsageService.shouldBlockUsage(organizationId);
  if (spending.blocked) {
    throw new SreInvestigationBillingError(spending.reason ?? "SRE investigation blocked by spending limit", "spending_limit");
  }

  return { billable: true as const };
}

export async function consumeSreInvestigationCredit(input: {
  organizationId: string;
  projectId: string;
  userId: string | null;
  incidentId: string;
  investigationRunId: string;
  useLiveConnectors: boolean;
}) {
  if (!isPolarEnabled()) {
    return { billed: false as const };
  }

  const now = new Date();
  return db.transaction(async (tx) => {
    const org = await tx.query.organization.findFirst({
      where: eq(organization.id, input.organizationId),
      columns: {
        id: true,
        usagePeriodStart: true,
        usagePeriodEnd: true,
      },
    });

    if (!org) {
      throw new SreInvestigationBillingError("Organization not found", "organization_not_found");
    }

    const periodStart = org.usagePeriodStart ?? now;
    const periodEnd = org.usagePeriodEnd ?? defaultPeriodEnd(now);

    await tx
      .update(organization)
      .set({
        sreInvestigationUnitsUsed: sql`COALESCE(${organization.sreInvestigationUnitsUsed}, 0) + ${SRE_INVESTIGATION_UNITS_PER_RUN}`,
      })
      .where(eq(organization.id, input.organizationId));

    const [event] = await tx
      .insert(usageEvents)
      .values({
        organizationId: input.organizationId,
        eventType: "sre_investigation",
        eventName: "sre_investigations",
        units: SRE_INVESTIGATION_UNITS_PER_RUN,
        unitType: "investigation_units",
        metadata: {
          projectId: input.projectId,
          incidentId: input.incidentId,
          investigationRunId: input.investigationRunId,
          userId: input.userId,
          useLiveConnectors: input.useLiveConnectors,
        },
        syncedToPolar: false,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        createdAt: now,
      })
      .returning({ id: usageEvents.id });

    return { billed: true as const, usageEventId: event?.id ?? null };
  });
}

export async function getSreInvestigationUsage(organizationId: string) {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    columns: { sreInvestigationUnitsUsed: true },
  });

  if (!org) {
    throw new SreInvestigationBillingError("Organization not found", "organization_not_found");
  }

  const plan = await subscriptionService.getOrganizationPlanSafe(organizationId);
  const used = Number(org.sreInvestigationUnitsUsed ?? 0);
  const included = Number(plan.sreInvestigationUnitsIncluded ?? 0);

  return {
    used,
    included,
    overage: Math.max(0, used - included),
  };
}
