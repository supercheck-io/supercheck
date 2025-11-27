import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { organization as orgTable, projects, member, projectMembers, session, invitation } from '@/db/schema';
import { getCurrentUser } from '@/lib/session';
import { eq, and, gte, desc } from 'drizzle-orm';
import { auth } from '@/utils/auth';
import { headers } from 'next/headers';
import { randomUUID } from 'crypto';
import { isCloudHosted, isPolarEnabled, getPolarConfig } from '@/lib/feature-flags';

/**
 * Link Polar customer to organization
 * Looks up the customer by externalId (user ID) and stores the polarCustomerId on the organization
 */
async function linkPolarCustomerToOrganization(userId: string, organizationId: string): Promise<void> {
  if (!isPolarEnabled()) {
    return;
  }

  try {
    const config = getPolarConfig();
    if (!config) {
      console.log('[Polar] Config not available, skipping customer link');
      return;
    }

    // Dynamically import Polar SDK
    const { Polar } = await import('@polar-sh/sdk');
    const polarClient = new Polar({
      accessToken: config.accessToken,
      server: config.server,
    });

    // Look up customer by externalId (which is the user ID set during signup)
    // The Polar plugin creates customers with externalId = user.id
    try {
      const customer = await polarClient.customers.getExternal({
        externalId: userId,
      });

      if (customer?.id) {
        console.log(`[Polar] Found customer ${customer.id} for user ${userId}, linking to organization ${organizationId}`);
        
        // Update organization with Polar customer ID
        await db
          .update(orgTable)
          .set({ polarCustomerId: customer.id })
          .where(eq(orgTable.id, organizationId));
        
        console.log(`[Polar] ✅ Linked customer ${customer.id} to organization ${organizationId}`);
      } else {
        console.log(`[Polar] No customer found for user ${userId} - customer may not have been created yet`);
      }
    } catch (lookupError) {
      // Customer not found is expected if Polar customer creation failed or hasn't completed
      console.log(`[Polar] Customer lookup failed for user ${userId}:`, lookupError instanceof Error ? lookupError.message : lookupError);
    }
  } catch (error) {
    // Log but don't fail - the webhook will still work via referenceId
    console.error('[Polar] Error linking customer to organization:', error);
  }
}

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

    // Link Polar customer to organization (for cloud mode)
    // This allows webhooks to find the organization by polarCustomerId
    // Note: Webhooks primarily use referenceId from checkout metadata
    // This customer linking is a fallback mechanism
    await linkPolarCustomerToOrganization(user.id, newOrg.id);

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