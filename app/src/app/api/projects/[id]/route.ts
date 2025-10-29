import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, hasPermission } from '@/lib/rbac/middleware';
import { db } from '@/utils/db';
import { projects, projectMembers, jobs, tests, monitors } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

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
    const { userId } = await requireAuth();
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
    
    // Check permission
    const canView = await hasPermission('project', 'view', {
      organizationId: project.organizationId,
      projectId
    });
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Get project stats
    const [jobCount, testCount, monitorCount] = await Promise.all([
      db.select({ count: jobs.id }).from(jobs).where(eq(jobs.projectId, projectId)),
      db.select({ count: tests.id }).from(tests).where(eq(tests.projectId, projectId)),
      db.select({ count: monitors.id }).from(monitors).where(eq(monitors.projectId, projectId))
    ]);
    
    // Get member count
    const memberCount = await db
      .select({ count: projectMembers.id })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    
    // Get user's role in project
    const userRole = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId)
      ))
      .limit(1);
    
    return NextResponse.json({
      success: true,
      project: {
        ...project,
        role: userRole.length > 0 ? userRole[0].role : null,
        stats: {
          jobCount: jobCount.length,
          testCount: testCount.length,
          monitorCount: monitorCount.length,
          memberCount: memberCount.length
        }
      }
    });
    
  } catch (error) {
    console.error('Failed to get project:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Project not found or access denied' },
          { status: 404 }
        );
      }
    }
    
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
    await requireAuth();
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
    
    // Check permission
    const canUpdate = await hasPermission('project', 'update', {
      organizationId,
      projectId
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
    console.error('Failed to update project:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Project not found or access denied' },
          { status: 404 }
        );
      }
    }
    
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
    await requireAuth();
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
    
    // Check permission - only owners can delete projects
    const canDelete = await hasPermission('project', 'delete', {
      organizationId,
      projectId
    });
    if (!canDelete) {
      return NextResponse.json(
        { error: 'Only project owners can delete projects' },
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
    console.error('Failed to delete project:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Project not found or access denied' },
          { status: 404 }
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to delete project' },
      { status: 500 }
    );
  }
}