import { NextRequest, NextResponse } from 'next/server';
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError } from '@/lib/auth-context';
import { db } from '@/utils/db';
import { runs, jobs } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

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
    const authCtx = await requireAuthContext();

    const canView = checkPermissionWithContext('run', 'view', authCtx);
    if (!canView) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }
    
    // Find the run and its associated job to get project and organization IDs
    const result = await db
      .select({
        runId: runs.id,
        projectId: runs.projectId,
        organizationId: jobs.organizationId,
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.projectId, authCtx.project.id),
        )
      )
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

    const hasDeletePermission = checkPermissionWithContext('run', 'delete', authCtx);
    const userRole = authCtx.project.userRole;

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

    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    
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