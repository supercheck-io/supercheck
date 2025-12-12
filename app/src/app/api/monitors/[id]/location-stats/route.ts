import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  monitors,
  monitorResults,
} from "@/db/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import {
  requireAuth,
  hasPermission,
  getUserOrgRole,
} from "@/lib/rbac/middleware";
import { isSuperAdmin } from "@/lib/admin";
import type {
  MonitorResultStatus,
  MonitoringLocation,
} from "@/db/schema";

type LocationSummary = {
  location: MonitoringLocation;
  totalChecks: number;
  upChecks: number;
  uptimePercentage: number;
  avgResponseTime: number | null;
  minResponseTime: number | null;
  maxResponseTime: number | null;
};

type LatestMonitorResult = {
  location: MonitoringLocation;
  checkedAt: Date | null;
  status: MonitorResultStatus;
  isUp: boolean;
  responseTimeMs: number | null;
};

/**
 * GET /api/monitors/[id]/location-stats
 * Returns aggregated statistics per location for a monitor.
 * Query params:
 *  - days: number of days to look back (default: 7)
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
  const days = parseInt(searchParams.get("days") || "7", 10);

  // Validate days parameter
  if (days < 1 || days > 90) {
    return NextResponse.json(
      { error: "Days must be between 1 and 90" },
      { status: 400 }
    );
  }

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

    // Calculate date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Run both queries in parallel for better performance
    const [locationStats, latestResults] = await Promise.all([
      // Get location-specific statistics
      db
        .select({
          location: monitorResults.location,
          totalChecks: sql<number>`count(*)`,
          upChecks: sql<number>`sum(case when ${monitorResults.isUp} then 1 else 0 end)`,
          avgResponseTime: sql<number>`avg(${monitorResults.responseTimeMs})`,
          minResponseTime: sql<number>`min(${monitorResults.responseTimeMs})`,
          maxResponseTime: sql<number>`max(${monitorResults.responseTimeMs})`,
        })
        .from(monitorResults)
        .where(
          and(
            eq(monitorResults.monitorId, id),
            gte(monitorResults.checkedAt, startDate)
          )
        )
        .groupBy(monitorResults.location),

      // Get latest result per location
      db
        .select({
          location: monitorResults.location,
          checkedAt: monitorResults.checkedAt,
          status: monitorResults.status,
          isUp: monitorResults.isUp,
          responseTimeMs: monitorResults.responseTimeMs,
        })
        .from(monitorResults)
        .where(eq(monitorResults.monitorId, id))
        .orderBy(desc(monitorResults.checkedAt))
        .limit(100), // Get enough to cover all locations
    ]);

    // Calculate uptime percentage for each location
    const stats: LocationSummary[] = locationStats.map((stat) => ({
      location: stat.location as MonitoringLocation,
      totalChecks: Number(stat.totalChecks),
      upChecks: Number(stat.upChecks),
      uptimePercentage:
        Number(stat.totalChecks) > 0
          ? (Number(stat.upChecks) / Number(stat.totalChecks)) * 100
          : 0,
      avgResponseTime: stat.avgResponseTime ? Number(stat.avgResponseTime) : null,
      minResponseTime: stat.minResponseTime ? Number(stat.minResponseTime) : null,
      maxResponseTime: stat.maxResponseTime ? Number(stat.maxResponseTime) : null,
    }));

    // Group by location to get the latest for each
    const latestByLocation = new Map<MonitoringLocation, LatestMonitorResult>();
    for (const result of latestResults) {
      const location = result.location as MonitoringLocation;
      if (!latestByLocation.has(location)) {
        latestByLocation.set(location, {
          location,
          checkedAt: result.checkedAt,
          status: result.status as MonitorResultStatus,
          isUp: result.isUp,
          responseTimeMs: result.responseTimeMs,
        });
      }
    }

    // Merge stats with latest results
    const enrichedStats = stats.map((stat) => {
      const latest = latestByLocation.get(stat.location);
      return {
        ...stat,
        latest: latest
          ? {
              ...latest,
              checkedAt: latest.checkedAt
                ? latest.checkedAt.toISOString()
                : null,
            }
          : null,
      };
    });

    return NextResponse.json({
      success: true,
      data: enrichedStats,
      meta: {
        monitorId: id,
        daysAnalyzed: days,
        startDate: startDate.toISOString(),
      },
    });
  } catch (error) {
    console.error(
      `Error fetching location stats for monitor ${id}:`,
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch location statistics" },
      { status: 500 }
    );
  }
}
