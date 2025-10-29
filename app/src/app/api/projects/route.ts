import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, hasPermission, getUserRole } from '@/lib/rbac/middleware';
import { getActiveOrganization, getUserProjects } from '@/lib/session';
import { getCurrentProjectContext } from '@/lib/project-context';
import { db } from '@/utils/db';
import { projects, projectMembers } from '@/db/schema';
import { logAuditEvent } from '@/lib/audit-logger';

/**
 * GET /api/projects
 * List all projects for the current user in the active organization
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    
    // Get organization ID from query params or use active organization
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId');
    
    let targetOrgId = organizationId;
    if (!targetOrgId) {
      const activeOrg = await getActiveOrganization();
      if (!activeOrg) {
        // User has no organization - this is likely a new user
        // Return empty projects array instead of error to trigger setup flow
        return NextResponse.json({
          success: true,
          data: [],
          currentProject: null,
          message: 'No organization found - user needs setup'
        });
      }
      targetOrgId = activeOrg.id;
    }

    const canView = await hasPermission('project', 'view', { organizationId: targetOrgId });

    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Get user's projects in the organization
    const userProjects = await getUserProjects(userId, targetOrgId);
    
    // Get current project context
    const currentProject = await getCurrentProjectContext();
    
    return NextResponse.json({
      success: true,
      data: userProjects,
      currentProject: currentProject
    });
    
  } catch (error) {
    console.error('Failed to get projects:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Organization not found or access denied' },
          { status: 404 }
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects
 * Create a new project in the organization
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    
    const body = await request.json();
    const { name, slug, description, organizationId } = body;
    
    if (!name) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }
    
    let targetOrgId = organizationId;
    if (!targetOrgId) {
      const activeOrg = await getActiveOrganization();
      if (!activeOrg) {
        return NextResponse.json(
          { error: 'No active organization found' },
          { status: 400 }
        );
      }
      targetOrgId = activeOrg.id;
    }
    
    // Get user role for security
    const userRole = await getUserRole(userId, targetOrgId);
    
    // Check permission to create projects
    const canCreate = await hasPermission('project', 'create', { organizationId: targetOrgId });
    if (!canCreate) {
      return NextResponse.json(
        { error: 'Insufficient permissions to create projects' },
        { status: 403 }
      );
    }
    
    // Check project limit
    const userProjects = await getUserProjects(userId, targetOrgId);
    const maxProjects = parseInt(process.env.MAX_PROJECTS_PER_ORG || '10');
    
    if (userProjects.length >= maxProjects) {
      return NextResponse.json(
        { error: `Maximum ${maxProjects} projects allowed per organization` },
        { status: 400 }
      );
    }
    
    // Create project
    const [newProject] = await db
      .insert(projects)
      .values({
        organizationId: targetOrgId,
        name,
        slug: slug || null,
        description: description || null,
        isDefault: false,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();
    
    // Add user as project editor (project ownership is handled by org membership in unified RBAC)
    await db
      .insert(projectMembers)
      .values({
        userId,
        projectId: newProject.id,
        role: 'project_editor',
        createdAt: new Date()
      });
    
    // Log the audit event for project creation
    await logAuditEvent({
      userId,
      organizationId: targetOrgId,
      action: 'project_created',
      resource: 'project',
      resourceId: newProject.id,
      metadata: {
        projectName: newProject.name,
        projectSlug: newProject.slug,
        description: newProject.description,
        organizationId: targetOrgId,
        userRole: userRole
      },
      success: true
    });
    
    return NextResponse.json({
      success: true,
      data: {
        id: newProject.id,
        name: newProject.name,
        slug: newProject.slug,
        description: newProject.description,
        organizationId: newProject.organizationId,
        isDefault: newProject.isDefault,
        status: newProject.status,
        createdAt: newProject.createdAt,
        role: userRole
      }
    }, { status: 201 });
    
  } catch (error) {
    console.error('Failed to create project:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Organization not found or access denied' },
          { status: 404 }
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}