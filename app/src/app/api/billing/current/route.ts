import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/rbac/middleware";
import { getActiveOrganization } from "@/lib/session";
import { subscriptionService } from "@/lib/services/subscription-service";
import { db } from "@/utils/db";
import { organization, monitors, statusPages, projects, member } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/billing/current
 * Get current subscription, usage, and plan limits for the active organization
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

    // Get organization details with subscription info
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, activeOrg.id),
    });

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Get plan limits (use safe version that doesn't throw for unsubscribed users)
    const plan = await subscriptionService.getOrganizationPlanSafe(activeOrg.id);

    // Get current usage (use safe version)
    const usage = await subscriptionService.getUsageSafe(activeOrg.id);

    // Get current resource counts
    const [monitorCount, statusPageCount, projectCount, memberCount] = await Promise.all([
      db.select({ count: monitors.id }).from(monitors).where(eq(monitors.organizationId, activeOrg.id)),
      db.select({ count: statusPages.id }).from(statusPages).where(eq(statusPages.organizationId, activeOrg.id)),
      db.select({ count: projects.id }).from(projects).where(eq(projects.organizationId, activeOrg.id)),
      db.select({ count: member.userId }).from(member).where(eq(member.organizationId, activeOrg.id)),
    ]);

    // Calculate billing period
    const periodStart = org.usagePeriodStart || org.createdAt;
    const periodEnd = org.usagePeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days from now

    return NextResponse.json({
      subscription: {
        plan: org.subscriptionPlan || "unlimited",
        status: org.subscriptionStatus || "none",
        subscriptionId: org.subscriptionId,
        polarCustomerId: org.polarCustomerId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      usage: {
        playwrightMinutes: {
          used: usage.playwrightMinutes.used,
          included: usage.playwrightMinutes.included,
          overage: usage.playwrightMinutes.overage,
          percentage: Math.round((usage.playwrightMinutes.used / usage.playwrightMinutes.included) * 100),
        },
        k6VuMinutes: {
          used: usage.k6VuMinutes.used,
          included: usage.k6VuMinutes.included,
          overage: usage.k6VuMinutes.overage,
          percentage: Math.round((usage.k6VuMinutes.used / usage.k6VuMinutes.included) * 100),
        },
      },
      limits: {
        monitors: {
          current: monitorCount.length,
          limit: plan.maxMonitors,
          remaining: Math.max(0, plan.maxMonitors - monitorCount.length),
          percentage: Math.round((monitorCount.length / plan.maxMonitors) * 100),
        },
        statusPages: {
          current: statusPageCount.length,
          limit: plan.maxStatusPages,
          remaining: Math.max(0, plan.maxStatusPages - statusPageCount.length),
          percentage: Math.round((statusPageCount.length / plan.maxStatusPages) * 100),
        },
        projects: {
          current: projectCount.length,
          limit: plan.maxProjects,
          remaining: Math.max(0, plan.maxProjects - projectCount.length),
          percentage: Math.round((projectCount.length / plan.maxProjects) * 100),
        },
        teamMembers: {
          current: memberCount.length,
          limit: plan.maxTeamMembers,
          remaining: Math.max(0, plan.maxTeamMembers - memberCount.length),
          percentage: Math.round((memberCount.length / plan.maxTeamMembers) * 100),
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
      },
    });
  } catch (error) {
    console.error("Error fetching billing information:", error);
    return NextResponse.json(
      { error: "Failed to fetch billing information" },
      { status: 500 }
    );
  }
}
