import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { member, user as userTable, projectMembers, projects } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getUserOrgRole } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError } from '@/lib/auth-context';
import { Role } from '@/lib/rbac/permissions';
import { logAuditEvent } from '@/lib/audit-logger';
import { updateMemberSchema } from '@/lib/validations/member';

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

    const body = await request.json();

    if (body.projectAssignments !== undefined && !Array.isArray(body.projectAssignments)) {
      return NextResponse.json(
        { error: 'Invalid project assignments' },
        { status: 400 }
      );
    }

    const rawProjectAssignments: unknown[] = Array.isArray(body.projectAssignments)
      ? body.projectAssignments
      : [];

    const extractedProjectIds = rawProjectAssignments.map((assignment) => {
      if (typeof assignment === 'string') {
        return assignment;
      }
      if (assignment && typeof assignment === 'object' && 'projectId' in assignment) {
        return (assignment as { projectId?: unknown }).projectId;
      }
      return undefined;
    });

    const hasInvalidProjectAssignments = extractedProjectIds.some(
      (projectId) => typeof projectId !== 'string' || projectId.trim().length === 0
    );

    if (hasInvalidProjectAssignments) {
      return NextResponse.json(
        { error: 'Invalid project assignments' },
        { status: 400 }
      );
    }

    const normalizedSelectedProjects = Array.from(
      new Set(extractedProjectIds.map((projectId) => (projectId as string).trim()))
    );

    // Validate request body using Zod schema
    const parseResult = updateMemberSchema.safeParse({
      role: body.role,
      selectedProjects: normalizedSelectedProjects,
    });

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return NextResponse.json(
        { error: firstError?.message || 'Invalid request data' },
        { status: 400 }
      );
    }

    const { role, selectedProjects: selectedProjectIds } = parseResult.data;
    const requiresProjectAssignments =
      role === 'project_editor' || role === 'project_admin';

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

    // Prevent org_admin from assigning org_admin role (only org_owner can promote to org_admin)
    if (role === 'org_admin' && orgRole !== Role.ORG_OWNER) {
      return NextResponse.json(
        { error: 'Only organization owners can assign the org_admin role' },
        { status: 403 }
      );
    }

    // Prevent org_admin from modifying another org_admin (only org_owner can)
    if (existingMember[0].role === 'org_admin' && orgRole !== Role.ORG_OWNER) {
      return NextResponse.json(
        { error: 'Only organization owners can modify org admin members' },
        { status: 403 }
      );
    }

    const oldRole = existingMember[0].role;

    // No role conversion needed - store new RBAC roles directly

    // Get current project assignments BEFORE the transaction for audit logging
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

    // SECURITY: Wrap all role update operations in a transaction
    // to prevent partial state (e.g., role updated but project assignments not changed)
    await db.transaction(async (tx) => {
      // Update member role
      await tx
        .update(member)
        .set({ 
          role: role
        })
        .where(and(
          eq(member.userId, resolvedParams.memberId),
          eq(member.organizationId, organizationId)
        ));

      // Always reset organization-scoped project assignments for this member first.
      // This keeps role/project state deterministic across all transitions.
      const organizationProjects = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.organizationId, organizationId));

      if (organizationProjects.length > 0) {
        await tx
          .delete(projectMembers)
          .where(
            and(
              eq(projectMembers.userId, resolvedParams.memberId),
              inArray(projectMembers.projectId, organizationProjects.map((project) => project.id))
            )
          );
      }

      // For project-scoped roles, validate exact project ownership/status and re-insert assignments.
      if (requiresProjectAssignments) {
        const validSelectedProjects = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.organizationId, organizationId),
              eq(projects.status, 'active'),
              inArray(projects.id, selectedProjectIds)
            )
          );

        if (validSelectedProjects.length !== selectedProjectIds.length) {
          throw new Error('MEMBER_PROJECT_SCOPE_MISMATCH');
        }

        if (validSelectedProjects.length > 0) {
          await tx.insert(projectMembers).values(
            validSelectedProjects.map((project) => ({
              userId: resolvedParams.memberId,
              projectId: project.id,
              role,
            }))
          );
        }
      }
    });

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
      message: actionDescription,
      data: {
        memberId: resolvedParams.memberId,
        newRole: role,
        oldRole
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'MEMBER_PROJECT_SCOPE_MISMATCH') {
      return NextResponse.json(
        { error: 'One or more selected projects are invalid for this organization' },
        { status: 400 }
      );
    }

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

    // Prevent org_admin from removing another org_admin (only org_owner can)
    if (existingMember[0].role === 'org_admin' && delOrgRole !== Role.ORG_OWNER) {
      return NextResponse.json(
        { error: 'Only organization owners can remove org admin members' },
        { status: 403 }
      );
    }

    // Remove member and their project assignments in a transaction
    await db.transaction(async (tx) => {
      // First, clean up project member assignments for this org's projects
      const orgProjectIds = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.organizationId, delOrgId));

      if (orgProjectIds.length > 0) {
        await tx
          .delete(projectMembers)
          .where(
            and(
              eq(projectMembers.userId, resolvedParams.memberId),
              inArray(projectMembers.projectId, orgProjectIds.map(p => p.id))
            )
          );
      }

      // Then remove member from organization
      await tx
        .delete(member)
        .where(and(
          eq(member.userId, resolvedParams.memberId),
          eq(member.organizationId, delOrgId)
        ));
    });

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
