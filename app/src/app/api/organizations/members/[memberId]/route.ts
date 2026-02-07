import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { member, user as userTable, projectMembers, projects } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getUserOrgRole } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError } from '@/lib/auth-context';
import { Role } from '@/lib/rbac/permissions';
import { logAuditEvent } from '@/lib/audit-logger';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId, organizationId } = await requireUserAuthContext();
    
    if (!organizationId) {
      return NextResponse.json(
        { error: 'No active organization found' },
        { status: 400 }
      );
    }

    // Check if user is org admin
    const orgRole = await getUserOrgRole(userId, organizationId);
    const isOrgAdmin = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;
    
    if (!isOrgAdmin) {
      return NextResponse.json(
        { error: 'Insufficient permissions to update member roles' },
        { status: 403 }
      );
    }

    const { role, projectAssignments } = await request.json();

    if (!role || !['project_viewer', 'project_editor', 'project_admin', 'org_admin', 'org_owner'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role provided' },
        { status: 400 }
      );
    }

    // Prevent changing owner role
    const existingMember = await db
      .select({
        id: member.userId,
        role: member.role,
        userName: userTable.name,
        userEmail: userTable.email
      })
      .from(member)
      .innerJoin(userTable, eq(member.userId, userTable.id))
      .where(and(
        eq(member.userId, resolvedParams.memberId),
        eq(member.organizationId, organizationId)
      ))
      .limit(1);

    if (existingMember.length === 0) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      );
    }

    if (existingMember[0].role === 'org_owner') {
      return NextResponse.json(
        { error: 'Cannot change owner role' },
        { status: 403 }
      );
    }

    // Prevent users from changing their own role
    if (resolvedParams.memberId === userId) {
      return NextResponse.json(
        { error: 'Cannot change your own role' },
        { status: 403 }
      );
    }

    const oldRole = existingMember[0].role;

    // No role conversion needed - store new RBAC roles directly

    // Update member role
    await db
      .update(member)
      .set({ 
        role: role
      })
      .where(and(
        eq(member.userId, resolvedParams.memberId),
        eq(member.organizationId, organizationId)
      ));

    // Get current project assignments for audit logging
    const currentProjectAssignments = await db
      .select({
        projectId: projectMembers.projectId,
        projectName: projects.name
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(
        and(
          eq(projectMembers.userId, resolvedParams.memberId),
          eq(projects.organizationId, organizationId)
        )
      );

    const oldProjectIds = currentProjectAssignments.map(p => p.projectId);

    // Handle project assignments if provided and not project_viewer
    if (projectAssignments && Array.isArray(projectAssignments) && role !== 'project_viewer') {
      // First, remove all existing project assignments for this user in this org
      const orgProjectIds = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.organizationId, organizationId));
      
      if (orgProjectIds.length > 0) {
        await db
          .delete(projectMembers)
          .where(
            and(
              eq(projectMembers.userId, resolvedParams.memberId),
              inArray(projectMembers.projectId, orgProjectIds.map(p => p.id))
            )
          );
      }

      // Then add new project assignments
      if (projectAssignments.length > 0) {
        const validProjectIds = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.organizationId, organizationId),
              inArray(projects.id, projectAssignments.map((p: { projectId: string }) => p.projectId))
            )
          );

        if (validProjectIds.length > 0) {
          await db.insert(projectMembers).values(
            validProjectIds.map(project => ({
              userId: resolvedParams.memberId,
              projectId: project.id,
              role: role // Use the same role for all project assignments
            }))
          );
        }
      }
    } else if (role === 'project_viewer') {
      // For project_viewer, remove all specific project assignments since they get access to all
      const orgProjectIds2 = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.organizationId, organizationId));
      
      if (orgProjectIds2.length > 0) {
        await db
          .delete(projectMembers)
          .where(
            and(
              eq(projectMembers.userId, resolvedParams.memberId),
              inArray(projectMembers.projectId, orgProjectIds2.map(p => p.id))
            )
          );
      }
    }

    // Get new project assignments after update for audit logging
    const newProjectAssignments = role !== 'project_viewer' ? await db
      .select({
        projectId: projectMembers.projectId,
        projectName: projects.name
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(
        and(
          eq(projectMembers.userId, resolvedParams.memberId),
          eq(projects.organizationId, organizationId)
        )
      ) : [];

    // Role update completed successfully

    // Calculate project assignment changes
    const addedProjects = newProjectAssignments.filter(np => 
      !oldProjectIds.includes(np.projectId)
    );
    const removedProjects = currentProjectAssignments.filter(cp => 
      !newProjectAssignments.some(np => np.projectId === cp.projectId)
    );

    // Determine if this is a role change, project change, or both
    const roleChanged = oldRole !== role;
    const projectsChanged = addedProjects.length > 0 || removedProjects.length > 0;
    
    let action = 'member_updated';
    let actionDescription = 'Member updated';
    
    if (roleChanged && projectsChanged) {
      action = 'member_role_and_projects_updated';
      actionDescription = 'Member role and project assignments updated';
    } else if (roleChanged) {
      action = 'member_role_updated';
      actionDescription = 'Member role updated';
    } else if (projectsChanged) {
      action = 'member_projects_updated';
      actionDescription = 'Member project assignments updated';
    }

    // Log the audit event with detailed project information
    await logAuditEvent({
      userId,
      organizationId,
      action,
      resource: 'member',
      resourceId: resolvedParams.memberId,
      metadata: {
        targetUserName: existingMember[0].userName,
        targetUserEmail: existingMember[0].userEmail,
        oldRole,
        newRole: role,
        roleChanged,
        projectsChanged,
        projectChanges: {
          added: addedProjects.map(p => ({ id: p.projectId, name: p.projectName })),
          removed: removedProjects.map(p => ({ id: p.projectId, name: p.projectName })),
          currentProjects: newProjectAssignments.map(p => ({ id: p.projectId, name: p.projectName })),
          previousProjects: currentProjectAssignments.map(p => ({ id: p.projectId, name: p.projectName }))
        },
        actionDescription
      },
      success: true
    });

    return NextResponse.json({
      success: true,
      message: `Member role updated to ${role}`,
      data: {
        memberId: resolvedParams.memberId,
        newRole: role,
        oldRole
      }
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error updating member role:', error);
    return NextResponse.json(
      { error: 'Failed to update member role' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId: currentUserId, organizationId: delOrgId } = await requireUserAuthContext();
    
    if (!delOrgId) {
      return NextResponse.json(
        { error: 'No active organization found' },
        { status: 400 }
      );
    }

    // Check if user is org admin
    const delOrgRole = await getUserOrgRole(currentUserId, delOrgId);
    const isOrgAdmin = delOrgRole === Role.ORG_ADMIN || delOrgRole === Role.ORG_OWNER;
    
    if (!isOrgAdmin) {
      return NextResponse.json(
        { error: 'Insufficient permissions to remove members' },
        { status: 403 }
      );
    }

    // Get member details for audit
    const existingMember = await db
      .select({
        id: member.userId,
        role: member.role,
        userName: userTable.name,
        userEmail: userTable.email
      })
      .from(member)
      .innerJoin(userTable, eq(member.userId, userTable.id))
      .where(and(
        eq(member.userId, resolvedParams.memberId),
        eq(member.organizationId, delOrgId)
      ))
      .limit(1);

    if (existingMember.length === 0) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      );
    }

    if (existingMember[0].role === 'org_owner') {
      return NextResponse.json(
        { error: 'Cannot remove organization owner' },
        { status: 403 }
      );
    }

    // Prevent users from removing themselves
    if (resolvedParams.memberId === currentUserId) {
      return NextResponse.json(
        { error: 'Cannot remove yourself from the organization' },
        { status: 403 }
      );
    }

    // Remove member from organization
    await db
      .delete(member)
      .where(and(
        eq(member.userId, resolvedParams.memberId),
        eq(member.organizationId, delOrgId)
      ));

    // Log the audit event
    await logAuditEvent({
      userId: currentUserId,
      organizationId: delOrgId,
      action: 'member_removed',
      resource: 'member',
      resourceId: resolvedParams.memberId,
      metadata: {
        removedUserName: existingMember[0].userName,
        removedUserEmail: existingMember[0].userEmail,
        removedUserRole: existingMember[0].role,
      },
      success: true
    });

    return NextResponse.json({
      success: true,
      message: 'Member removed from organization',
      data: {
        memberId: resolvedParams.memberId,
        removedRole: existingMember[0].role
      }
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error removing member:', error);
    return NextResponse.json(
      { error: 'Failed to remove member' },
      { status: 500 }
    );
  }
}