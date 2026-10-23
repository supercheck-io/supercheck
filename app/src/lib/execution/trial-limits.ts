import { and, eq, gt, gte, or, sql } from "drizzle-orm";
import {
  executionEntitlements,
  organization,
  sreInvestigationRuns,
  type planLimits,
} from "@/db/schema";
import catalog from "@/lib/billing/plan-catalog.json";
import { db } from "@/utils/db";

export type PaidAccessFields = Pick<
  typeof organization.$inferSelect,
  | "polarCustomerId"
  | "subscriptionPlan"
  | "subscriptionStatus"
  | "subscriptionEndsAt"
>;

/** Active (or still-running canceled) Plus/Pro subscription: paid access outranks any trial row. */
export function hasPaidAccess(org: PaidAccessFields, now: Date): boolean {
  if (
    !org.polarCustomerId ||
    !["plus", "pro"].includes(org.subscriptionPlan ?? "")
  )
    return false;
  if (
    org.subscriptionStatus === "active" ||
    org.subscriptionStatus === "past_due"
  )
    return true;
  return (
    org.subscriptionStatus === "canceled" &&
    !!org.subscriptionEndsAt &&
    org.subscriptionEndsAt > now
  );
}

export const TRIAL_DURATION_DAYS = catalog.trial.durationDays;

const trial = catalog.trial.limits;

/**
 * Limits granted to a trial organization. They give access to the whole product
 * while keeping cost and abuse bounded. The numbers live in the shared plan
 * catalog, so the app, the worker defaults and the public pricing page agree.
 * They are stored on the entitlement row, so support can adjust a single
 * organization without a deploy.
 */
export const TRIAL_LIMITS = {
  runningCapacity: trial.runningCapacity,
  queuedCapacity: trial.queuedCapacity,
  k6MaxVus: trial.k6MaxVus,
  playwrightBudgetMs: trial.playwrightMinutes * 60 * 1000,
  maxMonitors: trial.maxMonitors,
  minCheckIntervalMinutes: trial.minCheckIntervalMinutes,
  maxStatusPages: trial.maxStatusPages,
  maxStatusPageSubscribers: trial.maxStatusPageSubscribers,
  maxTeamMembers: trial.maxTeamMembers,
  maxProjects: trial.maxProjects,
  sreInvestigationUnits: trial.sreInvestigations,
  aiCredits: trial.aiCredits,
} as const;

type Entitlement = typeof executionEntitlements.$inferSelect;
type PlanLimits = typeof planLimits.$inferSelect;

export function isTrialActive(
  entitlement: Pick<Entitlement, "expiresAt"> | undefined | null,
  now = Date.now(),
): boolean {
  return (
    !!entitlement &&
    Number.isFinite(entitlement.expiresAt.getTime()) &&
    entitlement.expiresAt.getTime() > now
  );
}

/** The organization's unexpired trial entitlement, if it has one. */
export async function getActiveTrial(
  organizationId: string,
  database: Pick<typeof db, "query"> = db,
): Promise<Entitlement | undefined> {
  const entitlement = await database.query.executionEntitlements.findFirst({
    where: and(
      eq(executionEntitlements.organizationId, organizationId),
      gt(executionEntitlements.expiresAt, new Date()),
    ),
  });
  return isTrialActive(entitlement) ? entitlement : undefined;
}

/**
 * The plan-shaped view of a trial, so every existing limit check (monitors,
 * status pages, team members, projects, SRE, AI credits) enforces trial limits
 * without a second code path. The trial is never billed: no Polar customer,
 * overage or spending limit applies to it.
 */
export function trialPlanLimits(entitlement: Entitlement): PlanLimits {
  return {
    id: "trial",
    plan: "plus",
    maxMonitors: entitlement.maxMonitors,
    minCheckIntervalMinutes: entitlement.minCheckIntervalMinutes,
    playwrightMinutesIncluded: Math.floor(
      entitlement.playwrightBudgetMs / 60_000,
    ),
    k6VuMinutesIncluded: 0,
    aiCreditsIncluded: entitlement.aiCredits,
    sreInvestigationUnitsIncluded: String(entitlement.sreInvestigationUnits),
    runningCapacity: entitlement.runningCapacity,
    queuedCapacity: entitlement.queuedCapacity,
    maxTeamMembers: entitlement.maxTeamMembers,
    maxOrganizations: 1,
    maxProjects: entitlement.maxProjects,
    maxStatusPages: entitlement.maxStatusPages,
    maxStatusPageSubscribers: entitlement.maxStatusPageSubscribers,
    // Custom domains and SSO need production DNS/TLS and identity setup; keep them paid.
    customDomains: false,
    ssoEnabled: false,
    dataRetentionDays: 7,
    aggregatedDataRetentionDays: 30,
    jobDataRetentionDays: 30,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/**
 * A trial organization checks no more often than its entitlement allows, which
 * bounds the compute a trial can consume. Returns the minimum interval when the
 * requested one is too short, and null when allowed (including every paid plan).
 */
export async function trialCheckIntervalViolation(
  organizationId: string | null | undefined,
  frequencyMinutes: unknown,
  database: Pick<typeof db, "query" | "select"> = db,
): Promise<{ minimumMinutes: number } | null> {
  if (!organizationId) return null;
  const trial = await getActiveTrial(organizationId, database);
  if (!trial || Number(frequencyMinutes) >= trial.minCheckIntervalMinutes)
    return null;
  // The trial row outlives an upgrade; paid access always wins, so a subscriber keeps 1-minute checks.
  const [org] = await database
    .select({
      polarCustomerId: organization.polarCustomerId,
      subscriptionPlan: organization.subscriptionPlan,
      subscriptionStatus: organization.subscriptionStatus,
      subscriptionEndsAt: organization.subscriptionEndsAt,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (org && hasPaidAccess(org, new Date())) return null;
  return { minimumMinutes: trial.minCheckIntervalMinutes };
}

export interface TrialSummary {
  active: boolean;
  expiresAt: string;
  /** Whole days left, rounded up; 0 once the trial has ended. */
  daysRemaining: number;
}

export function summarizeTrial(
  entitlement: Pick<Entitlement, "expiresAt">,
  now = Date.now(),
): TrialSummary {
  const remainingMs = entitlement.expiresAt.getTime() - now;
  return {
    active: remainingMs > 0,
    expiresAt: entitlement.expiresAt.toISOString(),
    daysRemaining: remainingMs > 0 ? Math.ceil(remainingMs / 86_400_000) : 0,
  };
}

/** The trial summary for display, including a trial that has ended. Undefined if the organization never had one. */
export async function getTrialSummary(
  organizationId: string,
  database: Pick<typeof db, "query"> = db,
): Promise<TrialSummary | undefined> {
  const entitlement = await database.query.executionEntitlements.findFirst({
    where: eq(executionEntitlements.organizationId, organizationId),
  });
  return entitlement ? summarizeTrial(entitlement) : undefined;
}

/** Trials are granted at signup only when explicitly enabled (an operator launch switch). */
export function isTrialEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.TRIAL_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/** The entitlement row for a new organization's free trial, starting at `now`. */
export function buildTrialEntitlement(
  organizationId: string,
  now = new Date(),
): typeof executionEntitlements.$inferInsert {
  return {
    organizationId,
    expiresAt: new Date(now.getTime() + TRIAL_DURATION_DAYS * 86_400_000),
    ...TRIAL_LIMITS,
  };
}

/** Investigations a trial organization has started during its trial. */
export async function countTrialInvestigations(
  organizationId: string,
  trialEndsAt: Date,
  database: Pick<typeof db, "select"> = db,
): Promise<number> {
  const trialStartedAt = new Date(
    trialEndsAt.getTime() - TRIAL_DURATION_DAYS * 86_400_000,
  );
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(sreInvestigationRuns)
    .where(
      and(
        eq(sreInvestigationRuns.organizationId, organizationId),
        eq(sreInvestigationRuns.agentType, "investigation"),
        or(
          eq(sreInvestigationRuns.status, "running"),
          eq(sreInvestigationRuns.status, "completed"),
        ),
        gte(sreInvestigationRuns.createdAt, trialStartedAt),
      ),
    );
  return Number(row?.count ?? 0);
}

/** What a trial organization has used so far, for the usage display. */
export async function getTrialUsage(
  organizationId: string,
  entitlement: Pick<Entitlement, "expiresAt" | "playwrightUsedMs">,
  database: Pick<typeof db, "select"> = db,
) {
  return {
    playwrightMinutesUsed:
      Math.round((entitlement.playwrightUsedMs / 60_000) * 100) / 100,
    sreInvestigationsUsed: await countTrialInvestigations(
      organizationId,
      entitlement.expiresAt,
      database,
    ),
  };
}
