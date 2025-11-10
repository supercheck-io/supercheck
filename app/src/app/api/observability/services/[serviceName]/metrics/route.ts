/**
 * API Route: Get Service Metrics
 * Endpoint: GET /api/observability/services/:serviceName/metrics
 */

import { NextResponse, NextRequest } from "next/server";
import { getServiceMetrics } from "~/lib/observability";
import { requireProjectContext } from "@/lib/project-context";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serviceName: string }> }
) {
  try {
    // Authentication and authorization
    const { project, organizationId } = await requireProjectContext();

    const { serviceName } = await params;

    if (!serviceName) {
      return NextResponse.json(
        { error: "serviceName is required" },
        { status: 400 }
      );
    }

    // Parse time range
    const searchParams = req.nextUrl.searchParams;
    const timeRange = {
      start:
        searchParams.get("start") ||
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      end: searchParams.get("end") || new Date().toISOString(),
    };

    // Get service metrics (scoped to user's project)
    const metrics = await getServiceMetrics(serviceName, timeRange, project.id, organizationId);

    return NextResponse.json(metrics);
  } catch (error) {
    console.error("Error getting service metrics:", error);
    return NextResponse.json(
      {
        error: "Failed to get service metrics",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
