import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { invitation, member, organization, projects, projectMembers } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { requireAuth } from '@/lib/rbac/middleware';
import { getCurrentUser } from '@/lib/session';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const params = await context.params;
  const { token } = params;

  try {
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

    return NextResponse.json({
      success: true,
      data: {
        organizationName: invite.orgName,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt
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
      await requireAuth();
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
    if (currentUser.email !== invite.email) {
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

    // Add user to organization (with duplicate handling)
    try {
      await db
        .insert(member)
        .values({
          organizationId: invite.organizationId,
          userId: currentUser.id,
          role: invite.role as 'org_owner' | 'org_admin' | 'project_admin' | 'project_editor' | 'project_viewer',
          createdAt: new Date()
        });
    } catch (error: unknown) {
      // Handle duplicate membership gracefully
      const dbError = error as { constraint?: string; code?: string; message?: string };
      if (dbError?.constraint === 'member_uniqueUserOrg' || 
          dbError?.code === '23505' || 
          dbError?.message?.includes('duplicate key')) {
        console.log(`ℹ️ User ${currentUser.email} was already a member of organization ${invite.orgName} - continuing with invitation acceptance`);
      } else {
        throw error; // Re-throw other errors
      }
    }

    // Assign user to selected projects
    if (invite.selectedProjects) {
      try {
        // selectedProjects is now a jsonb array
        const selectedProjectIds = invite.selectedProjects as string[] | null;
        
        if (Array.isArray(selectedProjectIds) && selectedProjectIds.length > 0) {
          // Get the selected projects
          const selectedProjects = await db
            .select({
              id: projects.id,
              name: projects.name
            })
            .from(projects)
            .where(and(
              inArray(projects.id, selectedProjectIds),
              eq(projects.status, 'active')
            ));

          // Assign user to each selected project (with duplicate handling)
          for (const project of selectedProjects) {
            try {
              await db
                .insert(projectMembers)
                .values({
                  userId: currentUser.id,
                  projectId: project.id,
                  role: invite.role as 'org_owner' | 'org_admin' | 'project_admin' | 'project_editor' | 'project_viewer',
                  createdAt: new Date()
                });
            } catch (error: unknown) {
              // Handle duplicate project assignment gracefully
              const dbError = error as { constraint?: string; code?: string; message?: string };
              if (dbError?.constraint === 'project_members_uniqueUserProject' || 
                  dbError?.code === '23505' || 
                  dbError?.message?.includes('duplicate key')) {
                console.log(`ℹ️ User ${currentUser.email} was already assigned to project "${project.name}" - skipping`);
              } else {
                console.error(`Error assigning user to project "${project.name}":`, error);
                // Don't throw here - continue with other projects
              }
            }
          }
          
          const projectNames = selectedProjects.map(p => p.name);
          console.log(`✅ Assigned user ${currentUser.email} to projects: ${projectNames.join(', ')} in organization "${invite.orgName}"`);
        }
      } catch (error) {
        console.error('Error parsing selected projects:', error);
        console.warn(`⚠️ Could not assign user ${currentUser.email} to selected projects in organization "${invite.orgName}"`);
      }
    } else {
      console.warn(`⚠️ No selected projects found in invitation for user ${currentUser.email} in organization "${invite.orgName}"`);
    }

    // Update invitation status
    await db
      .update(invitation)
      .set({ status: 'accepted' })
      .where(eq(invitation.id, token));

    return NextResponse.json({
      success: true,
      data: {
        organizationName: invite.orgName,
        role: invite.role,
        message: `Successfully joined ${invite.orgName} as ${invite.role}`
      }
    });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return NextResponse.json(
      { error: 'Failed to accept invitation' },
      { status: 500 }
    );
  }
}