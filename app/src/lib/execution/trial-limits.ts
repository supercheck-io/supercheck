import { and, eq, gt } from "drizzle-orm";
import { executionEntitlements, type planLimits } from "@/db/schema";
import { db } from "@/utils/db";

export const TRIAL_DURATION_DAYS = 14;

/**
 * Limits granted to a trial organization. They give access to the whole product
 * while keeping cost and abuse bounded. The values are stored on the entitlement
 * row, so support can adjust a single organization without a deploy.
 */
export const TRIAL_LIMITS = {
  runningCapacity: 1,
  queuedCapacity: 5,
  k6MaxVus: 5,
  playwrightBudgetMs: 30 * 60 * 1000,
  maxMonitors: 5,
  minCheckIntervalMinutes: 5,
  maxStatusPages: 2,
  maxStatusPageSubscribers: 50,
  maxTeamMembers: 3,
  maxProjects: 3,
  sreInvestigationUnits: 5,
  aiCredits: 100,
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
  database: Pick<typeof db, "query"> = db,
): Promise<{ minimumMinutes: number } | null> {
  if (!organizationId) return null;
  const trial = await getActiveTrial(organizationId, database);
  if (!trial || Number(frequencyMinutes) >= trial.minCheckIntervalMinutes)
    return null;
  return { minimumMinutes: trial.minCheckIntervalMinutes };
}
