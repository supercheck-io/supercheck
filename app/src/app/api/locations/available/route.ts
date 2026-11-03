import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { getProjectAvailableLocationsWithMeta } from "@/lib/location-registry";
import { getActiveWorkerQueueNames } from "@/lib/worker-registry";

/**
 * GET /api/locations/available?projectId=xxx
 * Returns locations available for a specific project (respecting restrictions).
 *
 * Each location includes an `online` flag indicating whether at least one
 * worker is actively processing jobs for that location. The flag is purely
 * informational — **all enabled locations are always returned** so that
 * UI configuration does not silently drop regions during transient worker
 * outages.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();

    const projectId = request.nextUrl.searchParams.get("projectId");

    // Use authenticated project context if no projectId specified,
    // otherwise validate the requested project matches the user's context
    const resolvedProjectId = projectId ?? context.project.id;
    if (resolvedProjectId !== context.project.id) {
      return NextResponse.json(
        { success: false, error: "Access denied" },
        { status: 403 }
      );
    }

    const [available, activeQueueNames] = await Promise.all([
      getProjectAvailableLocationsWithMeta(resolvedProjectId),
      getActiveWorkerQueueNames().catch(() => {
        // If Redis heartbeat scan fails, return an empty set so that
        // all locations show as offline rather than crashing the entire
        // endpoint. The location list itself comes from the DB and is
        // still valid.
        return new Set<string>();
      }),
    ]);

    // Annotate each location with online status instead of filtering out
    // offline locations. This prevents the location-config UI from silently
    // removing regions when a worker is temporarily down.
    const locationsWithStatus = available.locations.map((location) => ({
      ...location,
      online:
        activeQueueNames.has(`k6-${location.code}`) ||
        activeQueueNames.has(`monitor-${location.code}`),
    }));

    return NextResponse.json({
      success: true,
      data: {
        ...available,
        locations: locationsWithStatus,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[locations/available] Failed to list locations:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
