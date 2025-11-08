/**
 * API Route: Query Metrics Time Series
 * Endpoint: GET /api/observability/metrics/timeseries
 */

import { NextResponse, NextRequest } from "next/server";
import { MetricFiltersSchema } from "~/types/observability";
import { queryMetrics } from "~/lib/observability";
import { requireAuth } from "~/lib/rbac/middleware";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Authentication and authorization
    await requireAuth();
    const organizationId = undefined; // Optional filter
    const projectId = req.nextUrl.searchParams.get("projectId") || undefined;

    // Parse query parameters
    const searchParams = req.nextUrl.searchParams;

    const filters = {
      organizationId,
      projectId,
      runType: searchParams.get("runType")
        ? searchParams.get("runType")!.split(",")
        : undefined,
      serviceName: searchParams.get("serviceName")
        ? searchParams.get("serviceName")!.split(",")
        : undefined,
      metricName: searchParams.get("metricName")
        ? searchParams.get("metricName")!.split(",")
        : undefined,
      timeRange: {
        start:
          searchParams.get("start") ||
          new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        end: searchParams.get("end") || new Date().toISOString(),
      },
      groupBy: searchParams.get("groupBy")
        ? searchParams.get("groupBy")!.split(",")
        : undefined,
      aggregation: (searchParams.get("aggregation") as "avg" | "sum" | "min" | "max" | "p50" | "p95" | "p99") || "p95",
      interval: searchParams.get("interval") || "1m",
    };

    // Validate filters
    const validatedFilters = MetricFiltersSchema.parse(filters);

    // Query metrics
    const result = await queryMetrics(validatedFilters);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error querying metrics:", error);
    return NextResponse.json(
      {
        error: "Failed to query metrics",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
