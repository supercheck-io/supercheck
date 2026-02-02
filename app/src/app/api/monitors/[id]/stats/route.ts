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
import {
  monitorAggregationService,
  calculatePercentile,
} from "@/lib/monitor-aggregation-service";

/**
 * GET /api/monitors/[id]/stats
 * Returns aggregated statistics for 24h and 30d periods.
 * 
 * PERFORMANCE OPTIMIZATION:
 * - For 30d stats: Uses pre-computed daily aggregates from `monitor_aggregates` table
 * - For 24h stats: Uses pre-computed hourly aggregates from `monitor_aggregates` table
 * - Falls back to raw query only if aggregates don't exist (new monitors)
 * 
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

    // Convert location filter for aggregate queries
    const locationParam = locationFilter as MonitoringLocation | null;

    // Try to use pre-computed aggregates first (O(1) performance)
    // This is the performance-optimized path for monitors with aggregated data
    const [aggregates24h, aggregates30d] = await Promise.all([
      monitorAggregationService.getAggregatedMetrics(
        id,
        "hourly",
        last24Hours,
        now,
        locationParam
      ),
      monitorAggregationService.getAggregatedMetrics(
        id,
        "daily",
        last30Days,
        now,
        locationParam
      ),
    ]);

    // Check if we have valid aggregated data
    const hasAggregates24h = aggregates24h.totalChecks > 0;
    const hasAggregates30d = aggregates30d.totalChecks > 0;

    // If aggregates exist, use them directly (fast path)
    // However, if P95 is null in aggregates but we have enough checks,
    // compute P95 from raw data (individual hourly aggregates may have had < 5 checks each)
    if (hasAggregates24h && hasAggregates30d) {
      let p95_24h = aggregates24h.p95ResponseMs;
      let p95_30d = aggregates30d.p95ResponseMs;

      // Compute P95 from raw data if aggregate P95 is null but we have sufficient checks
      // This handles the case where individual hourly/daily aggregates each had < 5 checks
      // but the total across all periods is sufficient for a meaningful P95
      if (p95_24h === null && aggregates24h.totalChecks >= 5) {
        const responseTimes24h = await db
          .select({ responseTimeMs: monitorResults.responseTimeMs })
          .from(monitorResults)
          .where(
            and(
              eq(monitorResults.monitorId, id),
              gte(monitorResults.checkedAt, last24Hours),
              eq(monitorResults.isUp, true),
              sql`${monitorResults.responseTimeMs} is not null`,
              locationFilter
                ? eq(monitorResults.location, locationFilter as MonitoringLocation)
                : sql`1=1`
            )
          );
        const sortedTimes = responseTimes24h
          .map((r) => r.responseTimeMs!)
          .sort((a, b) => a - b);
        p95_24h = calculatePercentile(sortedTimes, 95);
      }

      if (p95_30d === null && aggregates30d.totalChecks >= 5) {
        const responseTimes30d = await db
          .select({ responseTimeMs: monitorResults.responseTimeMs })
          .from(monitorResults)
          .where(
            and(
              eq(monitorResults.monitorId, id),
              gte(monitorResults.checkedAt, last30Days),
              eq(monitorResults.isUp, true),
              sql`${monitorResults.responseTimeMs} is not null`,
              locationFilter
                ? eq(monitorResults.location, locationFilter as MonitoringLocation)
                : sql`1=1`
            )
          );
        const sortedTimes = responseTimes30d
          .map((r) => r.responseTimeMs!)
          .sort((a, b) => a - b);
        p95_30d = calculatePercentile(sortedTimes, 95);
      }

      return NextResponse.json({
        success: true,
        data: {
          period24h: {
            totalChecks: aggregates24h.totalChecks,
            upChecks: Math.round(
              (aggregates24h.uptimePercentage / 100) * aggregates24h.totalChecks
            ),
            uptimePercentage: aggregates24h.uptimePercentage,
            avgResponseTimeMs: aggregates24h.avgResponseMs,
            p95ResponseTimeMs: p95_24h !== null ? Math.round(p95_24h) : null,
          },
          period30d: {
            totalChecks: aggregates30d.totalChecks,
            upChecks: Math.round(
              (aggregates30d.uptimePercentage / 100) * aggregates30d.totalChecks
            ),
            uptimePercentage: aggregates30d.uptimePercentage,
            avgResponseTimeMs: aggregates30d.avgResponseMs,
            p95ResponseTimeMs: p95_30d !== null ? Math.round(p95_30d) : null,
          },
        },
        meta: {
          monitorId: id,
          location: locationFilter || "all",
          calculatedAt: now.toISOString(),
          source: p95_24h !== aggregates24h.p95ResponseMs || p95_30d !== aggregates30d.p95ResponseMs
            ? "aggregates+raw_p95" // Indicates P95 was computed from raw data
            : "aggregates",
        },
      });
    }

    // Fallback: Query raw data for new monitors without aggregates
    // This ensures new monitors still show stats before the first aggregation run
    console.log(
      `[STATS] Monitor ${id.substring(0, 8)}: No aggregates found, falling back to raw query`
    );

    // Build base conditions for raw queries
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
        source: "raw", // Indicates data came from raw query (fallback)
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
