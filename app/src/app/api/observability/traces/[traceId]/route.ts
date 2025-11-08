/**
 * API Route: Get Trace by ID
 * Endpoint: GET /api/observability/traces/:traceId
 */

import { NextResponse, NextRequest } from "next/server";
import { getTrace } from "~/lib/observability";
import { requireAuth } from "~/lib/rbac/middleware";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ traceId: string }> }
) {
  try {
    // Authentication
    await requireAuth();

    const { traceId } = await params;

    if (!traceId) {
      return NextResponse.json(
        { error: "traceId is required" },
        { status: 400 }
      );
    }

    // Get trace
    const trace = await getTrace(traceId);

    if (!trace) {
      return NextResponse.json({ error: "Trace not found" }, { status: 404 });
    }

    return NextResponse.json(trace);
  } catch (error) {
    console.error("Error getting trace:", error);
    return NextResponse.json(
      {
        error: "Failed to get trace",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
