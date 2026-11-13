import { isUuid } from "@/lib/uuid";
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { projectMembers, projects } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { hasPermissionForUser, getUserRole, getUserOrgRole } from '@/lib/rbac/middleware';
import { hasPermission as roleAllows, Role } from '@/lib/rbac/permissions';
import { isOrgPendingDeletion } from '@/lib/deletion/org-state';
import { requireUserAuthContext, isAuthError, authErrorStatus } from '@/lib/auth-context';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId, organizationId: activeOrganizationId, projectId, isCliAuth } = await requireUserAuthContext();

    if (!activeOrganizationId) {
      return NextResponse.json(
        { error: 'No active organization found' },
        { status: 400 }
      );
    }

    let canManageMembers = await hasPermissionForUser(userId, 'member', 'update', {
      organizationId: activeOrganizationId,
    });
    // Reading saved assignments stays available while the organization is pending deletion: the same role check, without the
    // read-only block (changes to members are blocked on their own routes).
    if (!canManageMembers && (await isOrgPendingDeletion(activeOrganizationId, { fresh: true }))) {
      const role = await getUserRole(userId, activeOrganizationId);
      const isMember = !!(await getUserOrgRole(userId, activeOrganizationId)) || role === Role.SUPER_ADMIN;
      canManageMembers = isMember && roleAllows({ userId, role, organizationId: activeOrganizationId, orgPendingDeletion: false }, 'member', 'update');
    }

    if (!canManageMembers) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Get project assignments for the specific user in the active organization
    if (!isUuid((await params).userId)) return NextResponse.json({ error: "User not found" }, { status: 404 });
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
          eq(projects.organizationId, activeOrganizationId),
          isCliAuth && projectId ? eq(projects.id, projectId) : undefined
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
        { status: authErrorStatus(error) }
      );
    }

    console.error('Error fetching user project assignments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project assignments' },
      { status: 500 }
    );
  }
}