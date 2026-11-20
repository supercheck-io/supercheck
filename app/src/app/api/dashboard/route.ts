import { NextResponse } from "next/server";
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError, authErrorStatus } from '@/lib/auth-context';
import { getDashboardPayload } from "@/lib/dashboard/get-dashboard-payload";

export async function GET() {
  try {
    const context = await requireAuthContext();
    
    // Use current project context - no need for query params
    const targetProjectId = context.project.id;
    
    // PERFORMANCE: Use checkPermissionWithContext to avoid 5-8 duplicate DB queries
    const canView = checkPermissionWithContext('project', 'view', context);
    
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const response = NextResponse.json(await getDashboardPayload(context));

    // NOTE: Removed Cache-Control header to ensure fresh data on every request.
    // React Query handles client-side caching; HTTP caching was causing stale data issues.
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    
    return response;

  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: authErrorStatus(error) }
      );
    }
    // Log error for debugging but avoid logging sensitive data
    console.error("Dashboard API error:", error instanceof Error ? error.message : 'Unknown error');
    
    // Return generic error message to avoid information disclosure
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
} 
