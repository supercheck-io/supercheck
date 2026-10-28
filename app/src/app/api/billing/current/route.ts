import { NextResponse } from "next/server";
import { getTrialSummary } from "@/lib/execution/trial-limits";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";
import { subscriptionService } from "@/lib/services/subscription-service";
import { db } from "@/utils/db";
import {
  organization,
  monitors,
  statusPages,
  projects,
  member,
  invitation,
} from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { getPlanPricing, isCloudHosted } from "@/lib/feature-flags";

/**
 * GET /api/billing/current
 * Get current subscription, usage, and plan limits for the active organization
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

    // Get organization details with subscription info
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Get plan limits (use safe version that doesn't throw for unsubscribed users)
    const plan = await subscriptionService.getOrganizationPlanSafe(
      organizationId
    );

    // Get current usage (use safe version)
    const usage = await subscriptionService.getUsageSafe(organizationId);

    // Get current resource counts
    const [monitorCount, statusPageCount, projectCount, memberCount, pendingInviteCount] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(monitors)
          .where(eq(monitors.organizationId, organizationId)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(statusPages)
          .where(eq(statusPages.organizationId, organizationId)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(projects)
          .where(eq(projects.organizationId, organizationId)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(member)
          .where(eq(member.organizationId, organizationId)),
        // Pending invitations reserve a seat, as in the invite limit check.
        db
          .select({ count: sql<number>`count(*)` })
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, organizationId),
              eq(invitation.status, "pending"),
              gte(invitation.expiresAt, new Date()),
            ),
          ),
      ]);

    const monitorsTotal = Number(monitorCount[0]?.count || 0);
    const statusPagesTotal = Number(statusPageCount[0]?.count || 0);
    const projectsTotal = Number(projectCount[0]?.count || 0);
    const membersTotal =
      Number(memberCount[0]?.count || 0) + Number(pendingInviteCount[0]?.count || 0);

    // Use the same access decision as API enforcement and the subscription
    // guard; expired cancellations must not look like an active paid plan.
    const access = await subscriptionService.getSubscriptionAccessStatus(organizationId);
    const effectivePlan = access.isActive ? access.plan : null;
    // An organization on a free trial has no paid plan but does have allowances worth showing.
    const trial = access.isActive ? undefined : await getTrialSummary(organizationId);
    const pricing = effectivePlan ? getPlanPricing(effectivePlan) : null;
    const periodStart = org.usagePeriodStart ?? org.subscriptionStartedAt;
    const periodEnd = org.usagePeriodEnd ?? org.subscriptionEndsAt;

    const toPercent = (used: number, included: number) =>
      included > 0 ? Math.round((used / included) * 100) : 100;

    return NextResponse.json({
      organizationId,
      trial: trial ?? null,
      subscription: {
        plan: effectivePlan,
        status: access.status ?? "none",
        accessReason: access.reason,
        hasBillingCustomer: isCloudHosted() && Boolean(org.polarCustomerId),
        subscriptionEndsAt: access.subscriptionEndsAt ?? null,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        // Include pricing info for UI
        basePriceCents: pricing?.monthlyPriceCents ?? null,
        planName: pricing?.name ?? null,
      },
      usage: {
        playwrightMinutes: {
          used: usage.playwrightMinutes.used,
          included: usage.playwrightMinutes.included,
          overage: usage.playwrightMinutes.overage,
          percentage: toPercent(
            usage.playwrightMinutes.used,
            usage.playwrightMinutes.included
          ),
        },
        k6VuMinutes: {
          used: usage.k6VuMinutes.used,
          included: usage.k6VuMinutes.included,
          overage: usage.k6VuMinutes.overage,
          percentage: toPercent(usage.k6VuMinutes.used, usage.k6VuMinutes.included),
        },
        aiCredits: {
          used: usage.aiCredits.used,
          included: usage.aiCredits.included,
          overage: usage.aiCredits.overage,
          percentage: toPercent(usage.aiCredits.used, usage.aiCredits.included),
        },
        sreInvestigations: {
          used: usage.sreInvestigations.used,
          included: usage.sreInvestigations.included,
          overage: usage.sreInvestigations.overage,
          percentage: toPercent(
            usage.sreInvestigations.used,
            usage.sreInvestigations.included
          ),
        },
      },
      limits: {
        monitors: {
          current: monitorsTotal,
          limit: plan.maxMonitors,
          remaining: Math.max(0, plan.maxMonitors - monitorsTotal),
          percentage: toPercent(monitorsTotal, plan.maxMonitors),
        },
        statusPages: {
          current: statusPagesTotal,
          limit: plan.maxStatusPages,
          remaining: Math.max(0, plan.maxStatusPages - statusPagesTotal),
          percentage: toPercent(statusPagesTotal, plan.maxStatusPages),
        },
        projects: {
          current: projectsTotal,
          limit: plan.maxProjects,
          remaining: Math.max(0, plan.maxProjects - projectsTotal),
          percentage: toPercent(projectsTotal, plan.maxProjects),
        },
        teamMembers: {
          current: membersTotal,
          limit: plan.maxTeamMembers,
          remaining: Math.max(0, plan.maxTeamMembers - membersTotal),
          percentage: toPercent(membersTotal, plan.maxTeamMembers),
        },
        capacity: {
          runningCapacity: plan.runningCapacity,
          queuedCapacity: plan.queuedCapacity,
        },
      },
      planFeatures: {
        customDomains: plan.customDomains,
        dataRetentionDays: plan.dataRetentionDays,
        aggregatedDataRetentionDays: plan.aggregatedDataRetentionDays,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error fetching billing information:", error);
    return NextResponse.json(
      { error: "Failed to fetch billing information" },
      { status: 500 }
    );
  }
}
