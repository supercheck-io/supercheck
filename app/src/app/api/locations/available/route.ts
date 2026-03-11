import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { getProjectAvailableLocationsWithMeta } from "@/lib/location-registry";

/**
 * GET /api/locations/available?projectId=xxx
 * Returns locations available for a specific project (respecting restrictions).
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

    const available = await getProjectAvailableLocationsWithMeta(resolvedProjectId);
    return NextResponse.json({ success: true, data: available });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
