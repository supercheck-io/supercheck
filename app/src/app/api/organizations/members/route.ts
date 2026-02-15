import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { member, user as userTable, invitation, projectMembers, projects } from '@/db/schema';
import { eq, desc, and, or } from 'drizzle-orm';
import { getUserOrgRole } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError } from '@/lib/auth-context';
import { Role } from '@/lib/rbac/permissions';

export async function GET() {
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
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // PERFORMANCE: Run all queries in parallel to avoid sequential DB round trips
    const [members, invitations, currentUserRole, allProjectAssignments] = await Promise.all([
      // Get organization members
      db
        .select({
          id: userTable.id,
          name: userTable.name,
          email: userTable.email,
          role: member.role,
          joinedAt: member.createdAt
        })
        .from(member)
        .innerJoin(userTable, eq(member.userId, userTable.id))
        .where(eq(member.organizationId, organizationId))
        .orderBy(desc(member.id)), // UUIDv7 is time-ordered (PostgreSQL 18+)

      // Get pending and expired invitations for this organization
      db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          inviterName: userTable.name,
          inviterEmail: userTable.email
        })
        .from(invitation)
        .innerJoin(userTable, eq(invitation.inviterId, userTable.id))
        .where(
          and(
            eq(invitation.organizationId, organizationId),
            or(
              eq(invitation.status, 'pending'),
              eq(invitation.status, 'expired')
            )
          )
        )
        .orderBy(desc(invitation.expiresAt)),

      // Get current user's role in the organization
      db
        .select({ role: member.role })
        .from(member)
        .where(and(
          eq(member.userId, userId),
          eq(member.organizationId, organizationId)
        ))
        .limit(1),

      // Get all project assignments for members in this organization
      db
        .select({
          userId: projectMembers.userId,
          projectId: projectMembers.projectId,
          projectName: projects.name,
        })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(
          and(
            eq(projects.organizationId, organizationId),
            eq(projects.status, 'active')
          )
        ),
    ]);

    // Group project assignments by userId for efficient lookup
    const projectsByUserId = new Map<string, { projectId: string; projectName: string }[]>();
    for (const assignment of allProjectAssignments) {
      const existing = projectsByUserId.get(assignment.userId) ?? [];
      existing.push({ projectId: assignment.projectId, projectName: assignment.projectName });
      projectsByUserId.set(assignment.userId, existing);
    }

    // Enrich members with their project assignments
    const membersWithProjects = members.map((m) => ({
      ...m,
      projects: projectsByUserId.get(m.id) ?? [],
    }));

    return NextResponse.json({
      success: true,
      data: {
        members: membersWithProjects,
        invitations,
        currentUserRole: currentUserRole[0]?.role || 'project_viewer'
      }
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error fetching organization members:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization members' },
      { status: 500 }
    );
  }
}