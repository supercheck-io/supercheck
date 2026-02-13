import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { projectMembers, projects } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { hasPermissionForUser } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError } from '@/lib/auth-context';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId, organizationId: activeOrganizationId } = await requireUserAuthContext();

    if (!activeOrganizationId) {
      return NextResponse.json(
        { error: 'No active organization found' },
        { status: 400 }
      );
    }

    const canManageMembers = await hasPermissionForUser(userId, 'member', 'update', {
      organizationId: activeOrganizationId,
    });

    if (!canManageMembers) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Get project assignments for the specific user in the active organization
    const userProjectAssignments = await db
      .select({
        projectId: projectMembers.projectId,
        role: projectMembers.role,
        projectName: projects.name,
        projectDescription: projects.description
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(
        and(
          eq(projectMembers.userId, resolvedParams.userId),
          eq(projects.organizationId, activeOrganizationId)
        )
      );

    return NextResponse.json({
      success: true,
      projects: userProjectAssignments
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }

    console.error('Error fetching user project assignments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project assignments' },
      { status: 500 }
    );
  }
}