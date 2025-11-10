/**
 * API Route: Search Traces
 * Endpoint: GET /api/observability/traces/search
 */

import { NextResponse, NextRequest } from "next/server";
import { TraceFiltersSchema } from "~/types/observability";
import { searchTraces } from "~/lib/observability";
import { requireProjectContext } from "@/lib/project-context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Authentication and authorization
    const { project, organizationId } = await requireProjectContext();
    const requestedProjectId = req.nextUrl.searchParams.get("projectId");
    const projectId =
      requestedProjectId && requestedProjectId === project.id
        ? requestedProjectId
        : project.id;

    // Parse query parameters
    const searchParams = req.nextUrl.searchParams;

    const filters = {
      organizationId,
      projectId,
      runType: searchParams.get("runType")
        ? searchParams.get("runType")!.split(",")
        : undefined,
      runId: searchParams.get("runId") || undefined,
      testId: searchParams.get("testId") || undefined,
      jobId: searchParams.get("jobId") || undefined,
      monitorId: searchParams.get("monitorId") || undefined,
      serviceName: searchParams.get("serviceName")
        ? searchParams.get("serviceName")!.split(",")
        : undefined,
      status: searchParams.get("status")
        ? searchParams.get("status")!.split(",").map(Number)
        : undefined,
      minDuration: searchParams.get("minDuration")
        ? Number(searchParams.get("minDuration"))
        : undefined,
      maxDuration: searchParams.get("maxDuration")
        ? Number(searchParams.get("maxDuration"))
        : undefined,
      timeRange: {
        start:
          searchParams.get("start") ||
          new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        end: searchParams.get("end") || new Date().toISOString(),
      },
      search: searchParams.get("search") || undefined,
      limit: searchParams.get("limit")
        ? Number(searchParams.get("limit"))
        : 50,
      offset: searchParams.get("offset")
        ? Number(searchParams.get("offset"))
        : 0,
    };

    // Validate filters
    const validatedFilters = TraceFiltersSchema.parse(filters);

    // Search traces
    const result = await searchTraces(validatedFilters);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error searching traces:", error);
    return NextResponse.json(
      {
        error: "Failed to search traces",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
