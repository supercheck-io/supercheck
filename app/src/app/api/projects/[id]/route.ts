import { NextRequest, NextResponse } from 'next/server';
import { hasPermissionForUser } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError } from '@/lib/auth-context';
import { db } from '@/utils/db';
import { projects, projectMembers, jobs, tests, monitors } from '@/db/schema';
import { eq, and, count } from 'drizzle-orm';

/**
 * GET /api/projects/[id]
 * Get project details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId } = await requireUserAuthContext();
    const projectId = resolvedParams.id;
    
    // Get project to determine organization
    const projectData = await db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        description: projects.description,
        organizationId: projects.organizationId,
        isDefault: projects.isDefault,
        status: projects.status,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    
    if (projectData.length === 0) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    const project = projectData[0];
    
    const canView = await hasPermissionForUser(userId, 'project', 'view', {
      organizationId: project.organizationId,
      projectId,
    });

    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Get project stats using SQL count() aggregate (not fetching all rows)
    const [jobCountResult, testCountResult, monitorCountResult, memberCountResult, userRoleResult] = await Promise.all([
      db.select({ count: count() }).from(jobs).where(eq(jobs.projectId, projectId)),
      db.select({ count: count() }).from(tests).where(eq(tests.projectId, projectId)),
      db.select({ count: count() }).from(monitors).where(eq(monitors.projectId, projectId)),
      db.select({ count: count() }).from(projectMembers).where(eq(projectMembers.projectId, projectId)),
      db.select({ role: projectMembers.role }).from(projectMembers).where(and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId)
      )).limit(1),
    ]);
    
    return NextResponse.json({
      success: true,
      project: {
        ...project,
        role: userRoleResult.length > 0 ? userRoleResult[0].role : null,
        stats: {
          jobCount: jobCountResult[0]?.count || 0,
          testCount: testCountResult[0]?.count || 0,
          monitorCount: monitorCountResult[0]?.count || 0,
          memberCount: memberCountResult[0]?.count || 0
        }
      }
    });
    
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Failed to get project:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/projects/[id]
 * Update project details
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId } = await requireUserAuthContext();
    const projectId = resolvedParams.id;
    
    // Get project to determine organization
    const projectData = await db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    
    if (projectData.length === 0) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    const organizationId = projectData[0].organizationId;
    
    const canUpdate = await hasPermissionForUser(userId, 'project', 'update', {
      organizationId,
      projectId,
    });

    if (!canUpdate) {
      return NextResponse.json(
        { error: 'Insufficient permissions to update project' },
        { status: 403 }
      );
    }
    
    const body = await request.json();
    const { name, slug, description, status } = body;
    
    if (!name) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }
    
    // Update project
    const [updatedProject] = await db
      .update(projects)
      .set({
        name,
        slug: slug || null,
        description: description || null,
        status: status || 'active',
        updatedAt: new Date()
      })
      .where(eq(projects.id, projectId))
      .returning();
    
    if (!updatedProject) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      project: updatedProject
    });
    
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Failed to update project:', error);
    return NextResponse.json(
      { error: 'Failed to update project' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/[id]
 * Delete project (owner only)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId } = await requireUserAuthContext();
    const projectId = resolvedParams.id;
    
    // Get project to determine organization
    const projectData = await db
      .select({ organizationId: projects.organizationId, isDefault: projects.isDefault })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    
    if (projectData.length === 0) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    const { organizationId, isDefault } = projectData[0];
    
    // Prevent deletion of default project
    if (isDefault) {
      return NextResponse.json(
        { error: 'Cannot delete the default project' },
        { status: 400 }
      );
    }
    
    const canDelete = await hasPermissionForUser(userId, 'project', 'delete', {
      organizationId,
      projectId,
    });

    if (!canDelete) {
      return NextResponse.json(
        { error: 'Insufficient permissions to delete project' },
        { status: 403 }
      );
    }
    
    // Soft delete project (mark as deleted)
    await db
      .update(projects)
      .set({
        status: 'deleted',
        updatedAt: new Date()
      })
      .where(eq(projects.id, projectId));
    
    return NextResponse.json({
      success: true,
      message: 'Project deleted successfully'
    });
    
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Failed to delete project:', error);
    return NextResponse.json(
      { error: 'Failed to delete project' },
      { status: 500 }
    );
  }
}