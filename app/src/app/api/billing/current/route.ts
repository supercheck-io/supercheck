import { NextResponse } from "next/server";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { subscriptionService } from "@/lib/services/subscription-service";
import { db } from "@/utils/db";
import {
  organization,
  monitors,
  statusPages,
  projects,
  member,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getPlanPricing } from "@/lib/feature-flags";

/**
 * GET /api/billing/current
 * Get current subscription, usage, and plan limits for the active organization
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
    const [monitorCount, statusPageCount, projectCount, memberCount] =
      await Promise.all([
        db
          .select({ count: monitors.id })
          .from(monitors)
          .where(eq(monitors.organizationId, organizationId)),
        db
          .select({ count: statusPages.id })
          .from(statusPages)
          .where(eq(statusPages.organizationId, organizationId)),
        db
          .select({ count: projects.id })
          .from(projects)
          .where(eq(projects.organizationId, organizationId)),
        db
          .select({ count: member.userId })
          .from(member)
          .where(eq(member.organizationId, organizationId)),
      ]);

    // Calculate billing period
    const periodStart = org.usagePeriodStart || org.createdAt;
    const periodEnd =
      org.usagePeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days from now

    // Get plan pricing - determine appropriate plan based on hosting mode
    // In cloud mode: use actual subscription plan (only plus/pro are valid)
    // In self-hosted mode: always 'unlimited'
    const { isCloudHosted: cloudHosted } = await import("@/lib/feature-flags");
    let effectivePlan: "plus" | "pro" | "unlimited";
    if (cloudHosted()) {
      // Cloud mode: only plus/pro are valid plans
      // If org has unlimited or invalid plan, treat as unsubscribed (show plus for display)
      if (org.subscriptionPlan === "plus" || org.subscriptionPlan === "pro") {
        effectivePlan = org.subscriptionPlan;
      } else {
        // Unlimited or null in cloud mode = needs subscription
        effectivePlan = "plus"; // Default to plus for display purposes
      }
    } else {
      // Self-hosted: always unlimited
      effectivePlan = "unlimited";
    }
    const planType = effectivePlan;
    const pricing = getPlanPricing(planType);

    // Determine effective subscription status
    // In cloud mode with invalid plan (unlimited), status should be 'none' regardless of DB value
    let effectiveStatus = org.subscriptionStatus || "none";
    if (cloudHosted() && org.subscriptionPlan !== "plus" && org.subscriptionPlan !== "pro") {
      effectiveStatus = "none"; // Invalid plan = no subscription
    }

    const toPercent = (used: number, included: number) =>
      included > 0 ? Math.round((used / included) * 100) : 100;

    return NextResponse.json({
      subscription: {
        plan: effectivePlan,
        status: effectiveStatus,
        subscriptionId: org.subscriptionId,
        polarCustomerId: org.polarCustomerId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        // Include pricing info for UI
        basePriceCents: pricing.monthlyPriceCents,
        planName: pricing.name,
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
      },
      limits: {
        monitors: {
          current: monitorCount.length,
          limit: plan.maxMonitors,
          remaining: Math.max(0, plan.maxMonitors - monitorCount.length),
          percentage: toPercent(monitorCount.length, plan.maxMonitors),
        },
        statusPages: {
          current: statusPageCount.length,
          limit: plan.maxStatusPages,
          remaining: Math.max(0, plan.maxStatusPages - statusPageCount.length),
          percentage: toPercent(statusPageCount.length, plan.maxStatusPages),
        },
        projects: {
          current: projectCount.length,
          limit: plan.maxProjects,
          remaining: Math.max(0, plan.maxProjects - projectCount.length),
          percentage: toPercent(projectCount.length, plan.maxProjects),
        },
        teamMembers: {
          current: memberCount.length,
          limit: plan.maxTeamMembers,
          remaining: Math.max(0, plan.maxTeamMembers - memberCount.length),
          percentage: toPercent(memberCount.length, plan.maxTeamMembers),
        },
        capacity: {
          runningCapacity: plan.runningCapacity,
          queuedCapacity: plan.queuedCapacity,
        },
      },
      planFeatures: {
        customDomains: plan.customDomains,
        ssoEnabled: plan.ssoEnabled,
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
