import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { invitation, member, organization, projects, projectMembers, user as userTable } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { requireUserAuthContext, isAuthError } from '@/lib/auth-context';
import { getCurrentUser } from '@/lib/session';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const params = await context.params;
  const { token } = params;

  try {
    // Get invitation details with inviter info
    const inviteDetails = await db
      .select({
        id: invitation.id,
        organizationId: invitation.organizationId,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        selectedProjects: invitation.selectedProjects,
        orgName: organization.name,
        inviterName: userTable.name,
        inviterEmail: userTable.email,
      })
      .from(invitation)
      .innerJoin(organization, eq(invitation.organizationId, organization.id))
      .innerJoin(userTable, eq(invitation.inviterId, userTable.id))
      .where(eq(invitation.id, token))
      .limit(1);

    if (inviteDetails.length === 0) {
      return NextResponse.json(
        { error: 'Invitation not found' },
        { status: 404 }
      );
    }

    const invite = inviteDetails[0];

    // Check if invitation is expired
    if (new Date() > invite.expiresAt) {
      return NextResponse.json(
        { error: 'Invitation has expired' },
        { status: 400 }
      );
    }

    // Check if invitation is already used
    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: 'Invitation has already been used or cancelled' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        // NOTE: This endpoint serves both the invite acceptance page and the sign-in/sign-up
        // page (for pre-filling forms). The invite page requires role, expiresAt, and inviter
        // info to render the invitation details. The role is already disclosed in the
        // invitation email, so including it here does not increase exposure.
        organizationName: invite.orgName,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
        inviterName: invite.inviterName,
        inviterEmail: invite.inviterEmail,
      }
    });
  } catch (error) {
    console.error('Error fetching invitation:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invitation details' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const params = await context.params;
  const { token } = params;

  try {
    // Try to get current user, but don't require authentication
    let currentUser;
    try {
      await requireUserAuthContext();
      currentUser = await getCurrentUser();
    } catch {
      // User is not authenticated, that's ok for invitation acceptance
      return NextResponse.json(
        { error: 'Please sign in first to accept the invitation' },
        { status: 401 }
      );
    }

    if (!currentUser) {
      return NextResponse.json(
        { error: 'Please sign in first to accept the invitation' },
        { status: 401 }
      );
    }

    // Get invitation details
    const inviteDetails = await db
      .select({
        id: invitation.id,
        organizationId: invitation.organizationId,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        selectedProjects: invitation.selectedProjects,
        orgName: organization.name
      })
      .from(invitation)
      .innerJoin(organization, eq(invitation.organizationId, organization.id))
      .where(eq(invitation.id, token))
      .limit(1);

    if (inviteDetails.length === 0) {
      return NextResponse.json(
        { error: 'Invitation not found' },
        { status: 404 }
      );
    }

    const invite = inviteDetails[0];

    // Check if invitation is expired
    if (new Date() > invite.expiresAt) {
      return NextResponse.json(
        { error: 'Invitation has expired' },
        { status: 400 }
      );
    }

    // Check if invitation is already used
    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: 'Invitation has already been used or cancelled' },
        { status: 400 }
      );
    }

    // Check if the current user's email matches the invitation
    if (currentUser.email.toLowerCase().trim() !== invite.email.toLowerCase().trim()) {
      return NextResponse.json(
        { error: 'This invitation is for a different email address' },
        { status: 400 }
      );
    }

    // Check if user is already a member
    const existingMember = await db
      .select({ id: member.userId })
      .from(member)
      .where(and(
        eq(member.userId, currentUser.id),
        eq(member.organizationId, invite.organizationId)
      ))
      .limit(1);

    if (existingMember.length > 0) {
      return NextResponse.json(
        { error: 'You are already a member of this organization' },
        { status: 400 }
      );
    }

    // SECURITY: Wrap all invitation acceptance operations in a transaction
    // to prevent partial state (e.g., member added but projects not assigned,
    // or operations succeed but invitation not marked as accepted).
    await db.transaction(async (tx) => {
      // 1. Add user to organization
      try {
        await tx
          .insert(member)
          .values({
            organizationId: invite.organizationId,
            userId: currentUser.id,
            role: invite.role as 'org_owner' | 'org_admin' | 'project_admin' | 'project_editor' | 'project_viewer',
            createdAt: new Date()
          });
      } catch (error: unknown) {
        const dbError = error as { constraint?: string; code?: string; message?: string };
        if (dbError?.constraint === 'member_uniqueUserOrg' || 
            dbError?.code === '23505' || 
            dbError?.message?.includes('duplicate key')) {
          console.log(`ℹ️ User ${currentUser.email} was already a member of organization ${invite.orgName} - continuing`);
        } else {
          throw error;
        }
      }

      // 2. Assign user to selected projects
      if (invite.selectedProjects) {
        // Parse selectedProjects — handles both jsonb arrays and legacy JSON-stringified arrays
        let selectedProjectIds: string[] | null = null;
        const rawProjects = invite.selectedProjects;
        if (typeof rawProjects === "string") {
          try {
            const parsed = JSON.parse(rawProjects);
            selectedProjectIds = Array.isArray(parsed) ? parsed : null;
          } catch {
            selectedProjectIds = null;
          }
        } else if (Array.isArray(rawProjects)) {
          selectedProjectIds = rawProjects as string[];
        }

        if (Array.isArray(selectedProjectIds) && selectedProjectIds.length > 0) {
          const normalizedSelectedProjectIds = Array.from(
            new Set(
              selectedProjectIds.filter(
                (projectId): projectId is string =>
                  typeof projectId === "string" && projectId.trim().length > 0
              )
            )
          );

          if (normalizedSelectedProjectIds.length === 0) {
            throw new Error("INVITE_PROJECT_SCOPE_MISMATCH");
          }

          // SECURITY: Filter by organization ID to prevent cross-org project assignment
          const selectedProjectsList = await tx
            .select({
              id: projects.id,
              name: projects.name
            })
            .from(projects)
            .where(and(
              inArray(projects.id, normalizedSelectedProjectIds),
              eq(projects.status, 'active'),
              eq(projects.organizationId, invite.organizationId)
            ));

          // SECURITY: Require an exact project match. If any selected project is missing
          // (wrong org, inactive, or invalid), abort and roll back the invitation acceptance.
          if (selectedProjectsList.length !== normalizedSelectedProjectIds.length) {
            throw new Error("INVITE_PROJECT_SCOPE_MISMATCH");
          }

          for (const project of selectedProjectsList) {
            try {
              await tx
                .insert(projectMembers)
                .values({
                  userId: currentUser.id,
                  projectId: project.id,
                  role: invite.role as 'org_owner' | 'org_admin' | 'project_admin' | 'project_editor' | 'project_viewer',
                  createdAt: new Date()
                });
            } catch (error: unknown) {
              const dbError = error as { constraint?: string; code?: string; message?: string };
              if (dbError?.constraint === 'project_members_uniqueUserProject' || 
                  dbError?.code === '23505' || 
                  dbError?.message?.includes('duplicate key')) {
                console.log(`ℹ️ User ${currentUser.email} was already assigned to project "${project.name}" - skipping`);
              } else {
                // In a transaction, non-duplicate errors should cause rollback
                throw error;
              }
            }
          }
          
          const projectNames = selectedProjectsList.map(p => p.name);
          console.log(`✅ Assigned user ${currentUser.email} to projects: ${projectNames.join(', ')} in organization "${invite.orgName}"`);
        }
      }

      // 3. Mark invitation as accepted (inside transaction)
      await tx
        .update(invitation)
        .set({ status: 'accepted' })
        .where(eq(invitation.id, token));
    });

    return NextResponse.json({
      success: true,
      data: {
        organizationName: invite.orgName,
        role: invite.role,
        message: `Successfully joined ${invite.orgName} as ${invite.role}`
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITE_PROJECT_SCOPE_MISMATCH") {
      return NextResponse.json(
        { error: 'Invitation contains invalid project assignments. Please request a new invitation.' },
        { status: 400 }
      );
    }

    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }

    console.error('Error accepting invitation:', error);
    return NextResponse.json(
      { error: 'Failed to accept invitation' },
      { status: 500 }
    );
  }
}