import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, hasPermission } from '@/lib/rbac/middleware';
import { Role } from '@/lib/rbac/permissions';
import { db } from '@/utils/db';
import { runs, jobs } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  const params = await context.params;
  const { runId } = params;
  
  if (!runId) {
    return NextResponse.json({ error: "Run ID is required" }, { status: 400 });
  }

  try {
    await requireAuth();
    
    // Find the run and its associated job to get project and organization IDs
    const result = await db
      .select({
        runId: runs.id,
        projectId: jobs.projectId,
        organizationId: jobs.organizationId
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .where(eq(runs.id, runId))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const run = result[0];

    if (!run.organizationId || !run.projectId) {
      return NextResponse.json(
        { error: "Run data incomplete" },
        { status: 500 }
      );
    }

    // Check if user has permission to view runs
    const hasViewPermission = await hasPermission('run', 'view', {
      organizationId: run.organizationId,
      projectId: run.projectId
    });

    if (!hasViewPermission) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Get user's effective role for the response
    const hasDeletePermission = await hasPermission('run', 'delete', {
      organizationId: run.organizationId,
      projectId: run.projectId
    });

    // If user can delete runs, they have management permissions (PROJECT_ADMIN or higher)
    // Otherwise they only have view permissions (PROJECT_VIEWER or PROJECT_EDITOR without delete)
    const userRole = hasDeletePermission ? Role.PROJECT_ADMIN : Role.PROJECT_VIEWER;

    return NextResponse.json({
      success: true,
      data: {
        userRole,
        projectId: run.projectId,
        organizationId: run.organizationId
      }
    });

  } catch (error) {
    console.error('Error fetching run permissions:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Resource not found or access denied' },
          { status: 404 }
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch permissions' },
      { status: 500 }
    );
  }
}