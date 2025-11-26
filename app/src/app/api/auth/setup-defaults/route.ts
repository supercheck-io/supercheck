import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { organization as orgTable, projects, member, projectMembers, session, invitation } from '@/db/schema';
import { getCurrentUser } from '@/lib/session';
import { eq, and, gte, desc } from 'drizzle-orm';
import { auth } from '@/utils/auth';
import { headers } from 'next/headers';
import { randomUUID } from 'crypto';
import { isCloudHosted } from '@/lib/feature-flags';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Check if user already has an organization
    const [existingMember] = await db
      .select()
      .from(member)
      .where(eq(member.userId, user.id))
      .limit(1);

    if (existingMember) {
      return NextResponse.json({
        success: true,
        message: 'User already has organization setup'
      });
    }

    // Check if user has any pending invitations
    // If they have pending invitations, they should not get a default organization
    const [recentInvitation] = await db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.email, user.email),
          eq(invitation.status, 'pending'),
          gte(invitation.expiresAt, new Date())
        )
      )
      .orderBy(desc(invitation.expiresAt))
      .limit(1);

    if (recentInvitation) {
      console.log(`User ${user.email} was recently invited - not creating default organization`);
      return NextResponse.json({
        success: true,
        message: 'User was recently invited - skipping default organization setup'
      });
    }

    // Create default organization
    const isSelfHosted = !isCloudHosted();
    const [newOrg] = await db.insert(orgTable).values({
      name: `${user.name}'s Organization`,
      slug: randomUUID(),
      createdAt: new Date(),
      // Self-hosted: unlimited plan immediately
      // Cloud: null plan until Polar subscription via webhook
      subscriptionPlan: isSelfHosted ? 'unlimited' : null,
      subscriptionStatus: isSelfHosted ? 'active' : 'none',
    }).returning();

    // Add user as owner of the organization
    await db.insert(member).values({
      organizationId: newOrg.id,
      userId: user.id,
      role: 'org_owner',
      createdAt: new Date(),
    });

    // Create default project
    const [newProject] = await db.insert(projects).values({
      organizationId: newOrg.id,
      name: process.env.DEFAULT_PROJECT_NAME || 'Default Project',
      slug: randomUUID(),
      description: 'Your default project for getting started',
      isDefault: true,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    // Add user as project editor (in unified RBAC, project ownership is handled by org ownership)
    await db.insert(projectMembers).values({
      userId: user.id,
      projectId: newProject.id,
      role: 'project_editor',
      createdAt: new Date(),
    });

    // Set the new project as active in the user's session
    const sessionData = await auth.api.getSession({
      headers: await headers(),
    });
    
    if (sessionData?.session?.token) {
      await db
        .update(session)
        .set({ activeProjectId: newProject.id })
        .where(eq(session.token, sessionData.session.token));
    }

    console.log(`✅ Created default org "${newOrg.name}" and project "${newProject.name}" for user ${user.email}`);

    // Force a small delay to ensure database consistency
    await new Promise(resolve => setTimeout(resolve, 500));

    return NextResponse.json({
      success: true,
      data: {
        organization: newOrg,
        project: newProject
      },
      message: 'Default organization and project created successfully'
    });
  } catch (error) {
    console.error('❌ Failed to create default org/project:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to setup defaults' },
      { status: 500 }
    );
  }
}