import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { organization, sreInvestigationRuns, usageEvents } from "@/db/schema";
import { isPolarEnabled } from "@/lib/feature-flags";
import { createLogger } from "@/lib/logger/index";
import { polarUsageService } from "@/lib/services/polar-usage.service";
import { subscriptionService } from "@/lib/services/subscription-service";
import { db } from "@/utils/db";

const SRE_INVESTIGATION_UNITS_PER_RUN = "1.0000";
const DEFAULT_STUCK_RUN_AGE_MINUTES = 15;
const logger = createLogger({ module: "sre-investigation-billing" }) as {
  error: (data: unknown, message?: string) => void;
};

export async function failStuckSreInvestigationRuns(options?: {
  olderThanMinutes?: number;
}) {
  const olderThanMinutes = Math.max(
    5,
    options?.olderThanMinutes ?? DEFAULT_STUCK_RUN_AGE_MINUTES,
  );
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const completedAt = new Date();

  const failed = await db
    .update(sreInvestigationRuns)
    .set({
      status: "failed",
      completedAt,
      agentStateSnapshot: {
        mode: "sre_investigation_recovery",
        error: "Investigation exceeded the execution recovery window",
      },
      durationMs: sql<number>`FLOOR(EXTRACT(EPOCH FROM (${completedAt} - ${sreInvestigationRuns.startedAt})) * 1000)::integer`,
    })
    .where(
      and(
        eq(sreInvestigationRuns.status, "running"),
        lt(sreInvestigationRuns.startedAt, cutoff),
      ),
    )
    .returning({ id: sreInvestigationRuns.id });

  return { failed: failed.length };
}

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
    // Serialize billing for a run ID, then check the durable usage ledger.
    // This makes retries safe without coupling billing state to an API process.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.investigationRunId}))`
    );

    const existingEvent = await tx.query.usageEvents.findFirst({
      where: and(
        eq(usageEvents.organizationId, input.organizationId),
        eq(usageEvents.eventType, "sre_investigation"),
        sql`${usageEvents.metadata}->>'investigationRunId' = ${input.investigationRunId}`
      ),
      columns: { id: true },
    });

    if (existingEvent) {
      return {
        billed: true as const,
        usageEventId: existingEvent.id,
        duplicate: true as const,
      };
    }

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

    return {
      billed: true as const,
      usageEventId: event?.id ?? null,
      duplicate: false as const,
    };
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

export async function reconcileUnbilledSreInvestigations(options?: {
  lookbackHours?: number;
  batchSize?: number;
}) {
  if (!isPolarEnabled()) return { processed: 0, failed: 0 };

  const lookbackHours = Math.max(1, options?.lookbackHours ?? 24);
  const batchSize = Math.min(500, Math.max(1, options?.batchSize ?? 100));
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const candidates = await db
    .select({
      id: sreInvestigationRuns.id,
      organizationId: sreInvestigationRuns.organizationId,
      projectId: sreInvestigationRuns.projectId,
      incidentId: sreInvestigationRuns.incidentId,
      userId: sreInvestigationRuns.createdByUserId,
      agentType: sreInvestigationRuns.agentType,
      promptInput: sreInvestigationRuns.promptInput,
    })
    .from(sreInvestigationRuns)
    .leftJoin(
      usageEvents,
      and(
        eq(usageEvents.organizationId, sreInvestigationRuns.organizationId),
        eq(usageEvents.eventType, "sre_investigation"),
        // JSON extraction returns text, while the run primary key is UUID.
        // PostgreSQL does not implicitly compare text and UUID, so cast the
        // typed column instead of casting untrusted metadata into UUID.
        sql`${usageEvents.metadata}->>'investigationRunId' = CAST(${sreInvestigationRuns.id} AS text)`
      )
    )
    .where(
      and(
        eq(sreInvestigationRuns.status, "completed"),
        eq(sreInvestigationRuns.agentType, "investigation"),
        gte(sreInvestigationRuns.completedAt, since),
        isNull(usageEvents.id)
      )
    )
    .orderBy(asc(sreInvestigationRuns.completedAt))
    .limit(batchSize);

  let processed = 0;
  let failed = 0;
  for (const run of candidates) {
    // The SQL predicate is the primary boundary; retain this guard so future
    // query changes cannot accidentally bill triage or evidence-brief runs.
    if (!run.incidentId || run.agentType !== "investigation") continue;

    try {
      await consumeSreInvestigationCredit({
        organizationId: run.organizationId,
        projectId: run.projectId,
        userId: run.userId,
        incidentId: run.incidentId,
        investigationRunId: run.id,
        useLiveConnectors: run.promptInput?.liveConnectorsEnabled === true,
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        { error, investigationRunId: run.id },
        "Failed to reconcile SRE investigation billing",
      );
    }
  }

  return { processed, failed };
}
