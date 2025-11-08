/**
 * API Route: Search Logs
 * Endpoint: GET /api/observability/logs/search
 */

import { NextResponse, NextRequest } from "next/server";
import { LogFiltersSchema } from "~/types/observability";
import { searchLogs } from "~/lib/observability";
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
      runId: searchParams.get("runId") || undefined,
      serviceName: searchParams.get("serviceName")
        ? searchParams.get("serviceName")!.split(",")
        : undefined,
      severityLevel: searchParams.get("severityLevel")
        ? searchParams.get("severityLevel")!.split(",")
        : undefined,
      traceId: searchParams.get("traceId") || undefined,
      spanId: searchParams.get("spanId") || undefined,
      timeRange: {
        start:
          searchParams.get("start") ||
          new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        end: searchParams.get("end") || new Date().toISOString(),
      },
      search: searchParams.get("search") || undefined,
      limit: searchParams.get("limit")
        ? Number(searchParams.get("limit"))
        : 1000,
      offset: searchParams.get("offset")
        ? Number(searchParams.get("offset"))
        : 0,
    };

    // Validate filters
    const validatedFilters = LogFiltersSchema.parse(filters);

    // Search logs
    const result = await searchLogs(validatedFilters);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error searching logs:", error);
    return NextResponse.json(
      {
        error: "Failed to search logs",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
