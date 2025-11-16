/**
 * API Route: GET /api/observability/service-map
 * Get service map data (nodes and edges for topology visualization)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceMap } from "~/lib/observability/query-utils";
import type { TimeRange } from "~/types/observability";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!start || !end) {
      return NextResponse.json({ error: "start and end parameters are required" }, { status: 400 });
    }

    const timeRange: TimeRange = { start, end };

    const serviceMap = await getServiceMap(timeRange);

    return NextResponse.json(serviceMap);
  } catch (error) {
    console.error("[API] Error fetching service map:", error);
    return NextResponse.json(
      { error: "Failed to fetch service map" },
      { status: 500 }
    );
  }
}
