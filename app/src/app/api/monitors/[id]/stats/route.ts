import { isUuid } from "@/lib/uuid";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors, MonitoringLocation } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { monitorAggregationService } from "@/lib/monitor-aggregation-service";
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "monitor-stats-api" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

/**
 * GET /api/monitors/[id]/stats
 * Returns statistics for the last 24h and 30d.
 *
 * - Uptime counts checks (cycles), judged by the monitor's region rule; with `location` it counts that region.
 * - Windows are read from the hourly (24h) / daily (30d) aggregates plus the raw rows no aggregate covers
 *   (partial edges, the in-progress period, and periods the aggregator missed).
 * - 24h p95 is an exact percentile_cont over raw up-check response times; 30d p95 merges the daily
 *   response-time histograms (within ~2.5% of the exact value).
 * - Response times are up checks only.
 *
 * Query params:
 *  - location: optional region filter; "" and "all" mean no filter; unknown regions get 400
 */
export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  const params = await routeContext.params;
  const { id } = params;

  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawLocation = searchParams.get("location");
  // "" and "all" mean no filter (older API clients send them).
  const locationFilter = rawLocation === "" || rawLocation === "all" ? null : rawLocation;

  try {
    const authContext = await requireAuthContext();
    const canView = checkPermissionWithContext("monitor", "view", authContext);
    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions to view this monitor" },
        { status: 403 }
      );
    }

    // Find the monitor and verify its organization and project.
    if (!isUuid((await routeContext.params).id)) return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
    });

    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Check if user has access to this monitor
    if (monitor.organizationId !== authContext.organizationId || monitor.projectId !== authContext.project.id) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }


    if (locationFilter !== null) {
      const configured = monitor.config?.locationConfig?.locations;
      if (!(await monitorAggregationService.monitorHasLocation(id, configured, locationFilter))) {
        return NextResponse.json({ error: "Unknown location" }, { status: 400 });
      }
    }

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const locationParam = locationFilter as MonitoringLocation | null;

    const [window24h, window30d, p95Raw24h] = await Promise.all([
      monitorAggregationService.getWindowMetrics(id, "hourly", last24Hours, now, locationParam),
      monitorAggregationService.getWindowMetrics(id, "daily", last30Days, now, locationParam),
      monitorAggregationService.getRawP95(id, last24Hours, locationParam),
    ]);

    const period = (w: typeof window24h, p95: number | null) => ({
      totalChecks: w.totalChecks,
      upChecks: w.successfulChecks,
      uptimePercentage: w.uptimePercentage,
      avgResponseTimeMs: w.avgResponseMs,
      p95ResponseTimeMs: p95,
    });

    return NextResponse.json({
      success: true,
      data: {
        period24h: period(window24h, p95Raw24h),
        period30d: period(window30d, window30d.p95ResponseMs),
      },
      meta: {
        monitorId: id,
        location: locationFilter || "all",
        calculatedAt: now.toISOString(),
        source: "aggregates+raw",
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: authErrorStatus(error) }
      );
    }
    logger.error({ err: error, monitorId: id }, "Error fetching monitor stats");
    return NextResponse.json(
      { error: "Failed to fetch monitor stats" },
      { status: 500 }
    );
  }
}
