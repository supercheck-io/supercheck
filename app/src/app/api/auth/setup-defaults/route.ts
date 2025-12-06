import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { organization as orgTable, projects, member, projectMembers, session, invitation, user as userTable } from '@/db/schema';
import { getCurrentUser } from '@/lib/session';
import { eq, and, gte, desc } from 'drizzle-orm';
import { auth } from '@/utils/auth';
import { headers } from 'next/headers';
import { randomUUID } from 'crypto';
import { isCloudHosted, isPolarEnabled, getPolarConfig } from '@/lib/feature-flags';

/**
 * Ensure Polar customer exists and is linked to organization
 * This is critical for social auth (GitHub/Google) signups where:
 * - The Polar customer may not have been created (if Better Auth plugin didn't trigger)
 * - The customer data (email, name) may be incomplete
 * 
 * This function will:
 * 1. Try to find existing customer by externalId (user.id)
 * 2. If not found, try to find by email
 * 3. If still not found, CREATE a new customer
 * 4. Link the customer to the organization
 * 5. Update the customer with correct email/name
 */
async function ensurePolarCustomerAndLink(
  userId: string, 
  userEmail: string, 
  userName: string | null,
  organizationId: string
): Promise<string | null> {
  if (!isPolarEnabled()) {
    return null;
  }

  const config = getPolarConfig();
  if (!config) {
    console.log('[Polar] Config not available, skipping customer setup');
    return null;
  }

  try {
    const { Polar } = await import('@polar-sh/sdk');
    const polarClient = new Polar({
      accessToken: config.accessToken,
      server: config.server,
    });

    let customerId: string | null = null;

    // Step 1: Try to find customer by externalId (user.id)
    try {
      const existingCustomer = await polarClient.customers.getExternal({
        externalId: userId,
      });
      if (existingCustomer?.id) {
        customerId = existingCustomer.id;
        console.log(`[Polar] Found existing customer by externalId: ${customerId}`);
      }
    } catch {
      console.log(`[Polar] No customer found by externalId for user ${userId}`);
    }

    // Step 2: If not found by externalId, try to find by email
    if (!customerId) {
      try {
        const { result: customersByEmail } = await polarClient.customers.list({
          email: userEmail,
        });
        const existingCustomer = customersByEmail.items[0];
        if (existingCustomer?.id) {
          customerId = existingCustomer.id;
          console.log(`[Polar] Found existing customer by email: ${customerId}`);
          
          // Link this customer to the user by setting externalId
          await polarClient.customers.update({
            id: customerId,
            customerUpdate: {
              externalId: userId,
              name: userName || userEmail,
            },
          });
          console.log(`[Polar] ✅ Linked existing customer to user ${userId}`);
        }
      } catch (emailLookupError) {
        console.log(`[Polar] Could not lookup customer by email:`, emailLookupError instanceof Error ? emailLookupError.message : emailLookupError);
      }
    }

    // Step 3: If still not found, CREATE a new customer
    if (!customerId) {
      try {
        const newCustomer = await polarClient.customers.create({
          email: userEmail,
          name: userName || userEmail,
          externalId: userId,
          metadata: {
            userId: userId,
            source: 'supercheck-setup-defaults',
          },
        });
        customerId = newCustomer.id;
        console.log(`[Polar] ✅ Created new customer ${customerId} for user ${userId} (${userEmail})`);
      } catch (createError) {
        console.error(`[Polar] Failed to create customer for user ${userId}:`, createError instanceof Error ? createError.message : createError);
        return null;
      }
    }

    // Step 4: Link customer to organization
    if (customerId) {
      await db
        .update(orgTable)
        .set({ polarCustomerId: customerId })
        .where(eq(orgTable.id, organizationId));
      console.log(`[Polar] ✅ Linked customer ${customerId} to organization ${organizationId}`);

      // Step 5: Update customer with correct email/name (in case it was created with incomplete data)
      try {
        await polarClient.customers.updateExternal({
          externalId: userId,
          customerUpdateExternalID: {
            email: userEmail,
            name: userName || userEmail,
          },
        });
        console.log(`[Polar] ✅ Updated customer data for user ${userId}`);
      } catch (updateError) {
        console.log(`[Polar] Could not update customer data:`, updateError instanceof Error ? updateError.message : updateError);
      }
    }

    return customerId;
  } catch (error) {
    console.error('[Polar] Error in ensurePolarCustomerAndLink:', error);
    return null;
  }
}

export async function POST() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // In cloud mode, require email verification before creating org/Polar customer
    // This prevents creating unnecessary Polar customers for junk/unverified emails
    if (isCloudHosted()) {
      const [userData] = await db
        .select({ emailVerified: userTable.emailVerified })
        .from(userTable)
        .where(eq(userTable.id, currentUser.id))
        .limit(1);
      
      if (!userData?.emailVerified) {
        console.log(`[setup-defaults] Skipping for unverified email: ${currentUser.email}`);
        return NextResponse.json({
          success: false,
          error: 'Email verification required',
          message: 'Please verify your email before proceeding'
        }, { status: 403 });
      }
    }

    // Check if user already has an organization
    const [existingMember] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, currentUser.id))
      .limit(1);

    if (existingMember) {
      // User already has org, but in cloud mode we still need to ensure Polar customer exists
      // This handles users who created accounts in self-hosted mode and switched to cloud
      if (isCloudHosted()) {
        await ensurePolarCustomerAndLink(
          currentUser.id, 
          currentUser.email, 
          currentUser.name, 
          existingMember.organizationId
        );
      }
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
          eq(invitation.email, currentUser.email),
          eq(invitation.status, 'pending'),
          gte(invitation.expiresAt, new Date())
        )
      )
      .orderBy(desc(invitation.expiresAt))
      .limit(1);

    if (recentInvitation) {
      console.log(`User ${currentUser.email} was recently invited - not creating default organization`);
      return NextResponse.json({
        success: true,
        message: 'User was recently invited - skipping default organization setup'
      });
    }

    // Use a transaction to atomically check and create org/member/project
    // This prevents race conditions where multiple concurrent calls could create duplicate orgs
    const result = await db.transaction(async (tx) => {
      // CRITICAL: Acquire an advisory lock for this user to serialize concurrent requests
      // Using hashCode of the user ID to get a consistent lock key
      // pg_advisory_xact_lock is automatically released when transaction ends
      const userIdHash = currentUser.id.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      await tx.execute(`SELECT pg_advisory_xact_lock(${userIdHash})`);

      // Now safely check if user already has an organization (within the lock)
      const [existingMemberInTx] = await tx
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, currentUser.id))
        .limit(1);

      if (existingMemberInTx) {
        // Another call already created the org, return it
        return { existed: true, organizationId: existingMemberInTx.organizationId };
      }

      // Create default organization
      const isSelfHosted = !isCloudHosted();
      const [newOrg] = await tx.insert(orgTable).values({
        name: `${currentUser.name}'s Organization`,
        slug: randomUUID(),
        createdAt: new Date(),
        // Self-hosted: unlimited plan immediately
        // Cloud: null plan until Polar subscription via webhook
        subscriptionPlan: isSelfHosted ? 'unlimited' : null,
        subscriptionStatus: isSelfHosted ? 'active' : 'none',
      }).returning();

      // Add user as owner of the organization
      await tx.insert(member).values({
        organizationId: newOrg.id,
        userId: currentUser.id,
        role: 'org_owner',
        createdAt: new Date(),
      });

      // Create default project
      const [newProject] = await tx.insert(projects).values({
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
      await tx.insert(projectMembers).values({
        userId: currentUser.id,
        projectId: newProject.id,
        role: 'project_editor',
        createdAt: new Date(),
      });

      return { existed: false, organization: newOrg, project: newProject };
    });

    // Handle transaction result
    if (result.existed) {
      // Organization was created by another concurrent call
      console.log(`[setup-defaults] Race condition detected - org already exists for user ${currentUser.email}`);
      // Still ensure Polar customer exists in cloud mode
      if (isCloudHosted()) {
        await ensurePolarCustomerAndLink(
          currentUser.id,
          currentUser.email,
          currentUser.name,
          result.organizationId!
        );
      }
      return NextResponse.json({
        success: true,
        message: 'Organization already created by concurrent call'
      });
    }

    // Set the new project as active in the user's session
    const sessionData = await auth.api.getSession({
      headers: await headers(),
    });
    
    if (sessionData?.session?.token) {
      await db
        .update(session)
        .set({ activeProjectId: result.project!.id })
        .where(eq(session.token, sessionData.session.token));
    }

    console.log(`✅ Created default org "${result.organization!.name}" and project "${result.project!.name}" for user ${currentUser.email}`);

    // Create Polar customer and link to organization (CLOUD MODE ONLY)
    // In self-hosted mode, this is skipped completely - no Polar integration needed
    // In cloud mode, email verification is already confirmed above, so we can safely create the customer
    if (isCloudHosted()) {
      await ensurePolarCustomerAndLink(currentUser.id, currentUser.email, currentUser.name, result.organization!.id);
    }

    return NextResponse.json({
      success: true,
      data: {
        organization: result.organization,
        project: result.project
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