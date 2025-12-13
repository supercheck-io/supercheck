import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors, monitorResults, MonitoringLocation } from "@/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import {
  requireAuth,
  hasPermission,
  getUserOrgRole,
} from "@/lib/rbac/middleware";
import { isSuperAdmin } from "@/lib/admin";
import { calculatePercentile } from "@/lib/monitor-aggregation-service";

/**
 * GET /api/monitors/[id]/stats
 * Returns aggregated statistics for 24h and 30d periods.
 * Query params:
 *  - location: optional location filter
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;

  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(request.url);
  const locationFilter = searchParams.get("location");

  try {
    const { userId } = await requireAuth();

    // First, find the monitor to check permissions
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
    });

    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Check if user has access to this monitor
    const userIsSuperAdmin = await isSuperAdmin();

    if (!userIsSuperAdmin && monitor.organizationId && monitor.projectId) {
      const orgRole = await getUserOrgRole(userId, monitor.organizationId);

      if (!orgRole) {
        return NextResponse.json(
          { error: "Access denied: Not a member of this organization" },
          { status: 403 }
        );
      }

      try {
        const canView = await hasPermission("monitor", "view", {
          organizationId: monitor.organizationId,
          projectId: monitor.projectId,
        });

        if (!canView) {
          return NextResponse.json(
            { error: "Insufficient permissions to view this monitor" },
            { status: 403 }
          );
        }
      } catch (permissionError) {
        console.log(
          "Permission check failed, but user is org member:",
          permissionError
        );
      }
    }

    // Calculate date boundaries
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Build base conditions
    const baseConditions24h = locationFilter
      ? and(
          eq(monitorResults.monitorId, id),
          gte(monitorResults.checkedAt, last24Hours),
          eq(monitorResults.location, locationFilter as MonitoringLocation)
        )
      : and(
          eq(monitorResults.monitorId, id),
          gte(monitorResults.checkedAt, last24Hours)
        );

    const baseConditions30d = locationFilter
      ? and(
          eq(monitorResults.monitorId, id),
          gte(monitorResults.checkedAt, last30Days),
          eq(monitorResults.location, locationFilter as MonitoringLocation)
        )
      : and(
          eq(monitorResults.monitorId, id),
          gte(monitorResults.checkedAt, last30Days)
        );

    // Run all 4 statistics queries in parallel for better performance
    // This reduces response time by ~50-75% compared to sequential execution
    const [stats24h, stats30d, responseTimes24h, responseTimes30d] =
      await Promise.all([
        // Get 24h statistics
        db
          .select({
            totalChecks: sql<number>`count(*)`,
            upChecks: sql<number>`sum(case when ${monitorResults.isUp} then 1 else 0 end)`,
            avgResponseTime: sql<number>`avg(case when ${monitorResults.isUp} then ${monitorResults.responseTimeMs} else null end)`,
          })
          .from(monitorResults)
          .where(baseConditions24h),

        // Get 30d statistics
        db
          .select({
            totalChecks: sql<number>`count(*)`,
            upChecks: sql<number>`sum(case when ${monitorResults.isUp} then 1 else 0 end)`,
            avgResponseTime: sql<number>`avg(case when ${monitorResults.isUp} then ${monitorResults.responseTimeMs} else null end)`,
          })
          .from(monitorResults)
          .where(baseConditions30d),

        // Get all response times for P95 calculation (24h)
        db
          .select({
            responseTimeMs: monitorResults.responseTimeMs,
          })
          .from(monitorResults)
          .where(
            and(
              baseConditions24h,
              eq(monitorResults.isUp, true),
              sql`${monitorResults.responseTimeMs} is not null`
            )
          ),

        // Get all response times for P95 calculation (30d)
        db
          .select({
            responseTimeMs: monitorResults.responseTimeMs,
          })
          .from(monitorResults)
          .where(
            and(
              baseConditions30d,
              eq(monitorResults.isUp, true),
              sql`${monitorResults.responseTimeMs} is not null`
            )
          ),
      ]);

    // Calculate P95 for 24h using shared utility
    const sortedTimes24h = responseTimes24h
      .map((r) => r.responseTimeMs!)
      .sort((a, b) => a - b);
    const p95Response24h = calculatePercentile(sortedTimes24h, 95);

    // Calculate P95 for 30d using shared utility
    const sortedTimes30d = responseTimes30d
      .map((r) => r.responseTimeMs!)
      .sort((a, b) => a - b);
    const p95Response30d = calculatePercentile(sortedTimes30d, 95);

    // Calculate uptime percentages
    const total24h = Number(stats24h[0]?.totalChecks || 0);
    const up24h = Number(stats24h[0]?.upChecks || 0);
    const uptime24h = total24h > 0 ? (up24h / total24h) * 100 : null;

    const total30d = Number(stats30d[0]?.totalChecks || 0);
    const up30d = Number(stats30d[0]?.upChecks || 0);
    const uptime30d = total30d > 0 ? (up30d / total30d) * 100 : null;

    const avgResponse24h = stats24h[0]?.avgResponseTime
      ? Number(stats24h[0].avgResponseTime)
      : null;
    const avgResponse30d = stats30d[0]?.avgResponseTime
      ? Number(stats30d[0].avgResponseTime)
      : null;

    return NextResponse.json({
      success: true,
      data: {
        period24h: {
          totalChecks: total24h,
          upChecks: up24h,
          uptimePercentage: uptime24h,
          avgResponseTimeMs: avgResponse24h ? Math.round(avgResponse24h) : null,
          p95ResponseTimeMs: p95Response24h ? Math.round(p95Response24h) : null,
        },
        period30d: {
          totalChecks: total30d,
          upChecks: up30d,
          uptimePercentage: uptime30d,
          avgResponseTimeMs: avgResponse30d ? Math.round(avgResponse30d) : null,
          p95ResponseTimeMs: p95Response30d ? Math.round(p95Response30d) : null,
        },
      },
      meta: {
        monitorId: id,
        location: locationFilter || "all",
        calculatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error(`Error fetching stats for monitor ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to fetch monitor statistics" },
      { status: 500 }
    );
  }
}
