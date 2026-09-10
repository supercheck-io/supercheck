import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  organization as orgTable,
  projects,
  member,
  projectMembers,
  session,
  invitation,
  user as userTable,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { eq, and, gte, desc, sql, isNull } from "drizzle-orm";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { randomUUID } from "crypto";
import {
  isCloudHosted,
  isPolarEnabled,
  getPolarConfig,
} from "@/lib/feature-flags";
import { requireSameOriginRequest } from "@/lib/security/same-origin";

/**
 * Provision one Polar customer per organization. Preserve existing customer IDs:
 * legacy bindings may have paid subscriptions and require explicit migration.
 */
async function ensurePolarCustomerAndLink(
  userId: string,
  userEmail: string,
  userName: string | null,
  organizationId: string,
): Promise<string | null> {
  if (!isPolarEnabled()) return null;
  const config = getPolarConfig();
  if (!config) return null;

  try {
    const org = await db.query.organization.findFirst({
      where: eq(orgTable.id, organizationId),
      columns: { polarCustomerId: true },
    });
    if (!org) return null;
    if (org.polarCustomerId) return org.polarCustomerId;

    const { Polar } = await import("@polar-sh/sdk");
    const polarClient = new Polar({
      accessToken: config.accessToken,
      server: config.server,
    });
    // A person may own several organizations. User ID/email are not billing
    // tenant identifiers and must never select another organization's customer.
    const externalId = `organization:${organizationId}`;
    let customerId: string;
    try {
      customerId = (await polarClient.customers.getExternal({ externalId })).id;
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          error.statusCode === 404
        )
      ) {
        throw error;
      }
      try {
        customerId = (
          await polarClient.customers.create({
            externalId,
            email: userEmail,
            name: userName || userEmail,
            metadata: {
              userId,
              referenceId: organizationId,
              source: "supercheck-setup-defaults",
            },
          })
        ).id;
      } catch (createError) {
        // A concurrent setup may have created the same external ID first.
        // Resolve only this organization's identity; never fall back to email.
        try {
          customerId = (await polarClient.customers.getExternal({ externalId }))
            .id;
        } catch {
          throw createError;
        }
      }
    }

    const [linked] = await db
      .update(orgTable)
      .set({ polarCustomerId: customerId })
      .where(
        and(eq(orgTable.id, organizationId), isNull(orgTable.polarCustomerId)),
      )
      .returning({ polarCustomerId: orgTable.polarCustomerId });
    if (linked) return linked.polarCustomerId;

    const current = await db.query.organization.findFirst({
      where: eq(orgTable.id, organizationId),
      columns: { polarCustomerId: true },
    });
    return current?.polarCustomerId ?? null;
  } catch (error) {
    console.error(
      "[Polar] Customer setup failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return null;
  }
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 },
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
        console.log(
          `[setup-defaults] Skipping for unverified email: ${currentUser.email}`,
        );
        return NextResponse.json(
          {
            success: false,
            error: "Email verification required",
            message: "Please verify your email before proceeding",
          },
          { status: 403 },
        );
      }
    }

    // Check if user already has an organization
    const existingMemberships = await db
      .select({
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .where(eq(member.userId, currentUser.id));

    if (existingMemberships.length > 0) {
      // Only the organization owner may establish its Polar customer binding.
      // Invited members also pass through this endpoint; allowing them to relink
      // billing would let an ordinary member replace the organization's customer.
      if (isCloudHosted()) {
        // A user can belong to several organizations. Repair every organization
        // they own so an unordered non-owner membership cannot mask an owned org.
        // Keep this sequential to avoid concurrent Polar customer creation.
        for (const ownedMembership of existingMemberships.filter(
          (membership) => membership.role === "org_owner",
        )) {
          await ensurePolarCustomerAndLink(
            currentUser.id,
            currentUser.email,
            currentUser.name,
            ownedMembership.organizationId,
          );
        }
      }
      return NextResponse.json({
        success: true,
        message: "User already has organization setup",
      });
    }

    // Check if user has any pending invitations
    // If they have pending invitations, they should not get a default organization
    // IMPORTANT: Use case-insensitive email comparison because Better Auth stores
    // emails lowercase but invitations may store the original case from admin input.
    const [recentInvitation] = await db
      .select()
      .from(invitation)
      .where(
        and(
          sql`LOWER(${invitation.email}) = LOWER(${currentUser.email})`,
          eq(invitation.status, "pending"),
          gte(invitation.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(invitation.expiresAt))
      .limit(1);

    if (recentInvitation) {
      console.log(
        `User ${currentUser.email} was recently invited - not creating default organization`,
      );
      return NextResponse.json({
        success: true,
        message:
          "User was recently invited - skipping default organization setup",
        pendingInvitationId: recentInvitation.id,
      });
    }

    // Use a transaction to atomically check and create org/member/project
    // This prevents race conditions where multiple concurrent calls could create duplicate orgs
    const result = await db.transaction(async (tx) => {
      // CRITICAL: Acquire an advisory lock for this user to serialize concurrent requests
      // Using hashCode of the user ID to get a consistent lock key
      // pg_advisory_xact_lock is automatically released when transaction ends
      const userIdHash = currentUser.id.split("").reduce((a, b) => {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
      }, 0);
      await tx.execute(`SELECT pg_advisory_xact_lock(${userIdHash})`);

      // Now safely check if user already has an organization (within the lock)
      const existingMembershipsInTx = await tx
        .select({
          organizationId: member.organizationId,
          role: member.role,
        })
        .from(member)
        .where(eq(member.userId, currentUser.id));

      if (existingMembershipsInTx.length > 0) {
        // Another call already created or joined an org. Return every owned org
        // so the post-transaction Polar repair cannot depend on row ordering.
        return {
          existed: true as const,
          ownedOrganizationIds: existingMembershipsInTx
            .filter((membership) => membership.role === "org_owner")
            .map((membership) => membership.organizationId),
        };
      }

      // Create default organization
      const isSelfHosted = !isCloudHosted();
      const [newOrg] = await tx
        .insert(orgTable)
        .values({
          name: `${currentUser.name}'s Organization`,
          slug: randomUUID(),
          createdAt: new Date(),
          // Self-hosted: unlimited plan immediately
          // Cloud: null plan until Polar subscription via webhook
          subscriptionPlan: isSelfHosted ? "unlimited" : null,
          subscriptionStatus: isSelfHosted ? "active" : "none",
        })
        .returning();

      // Add user as owner of the organization
      await tx.insert(member).values({
        organizationId: newOrg.id,
        userId: currentUser.id,
        role: "org_owner",
        createdAt: new Date(),
      });

      // Create default project
      const [newProject] = await tx
        .insert(projects)
        .values({
          organizationId: newOrg.id,
          name: process.env.DEFAULT_PROJECT_NAME || "Default Project",
          slug: randomUUID(),
          description: "Your default project for getting started",
          isDefault: true,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Add user as project editor (in unified RBAC, project ownership is handled by org ownership)
      await tx.insert(projectMembers).values({
        userId: currentUser.id,
        projectId: newProject.id,
        role: "project_editor",
        createdAt: new Date(),
      });

      return {
        existed: false as const,
        organization: newOrg,
        project: newProject,
      };
    });

    // Handle transaction result
    if (result.existed) {
      // Organization was created by another concurrent call
      console.log(
        `[setup-defaults] Race condition detected - org already exists for user ${currentUser.email}`,
      );
      // Still ensure Polar customer exists in cloud mode
      if (isCloudHosted()) {
        for (const organizationId of result.ownedOrganizationIds) {
          await ensurePolarCustomerAndLink(
            currentUser.id,
            currentUser.email,
            currentUser.name,
            organizationId,
          );
        }
      }
      return NextResponse.json({
        success: true,
        message: "Organization already created by concurrent call",
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

    console.log(
      `✅ Created default org "${result.organization!.name}" and project "${result.project!.name}" for user ${currentUser.email}`,
    );

    // Create Polar customer and link to organization (CLOUD MODE ONLY)
    // In self-hosted mode, this is skipped completely - no Polar integration needed
    // In cloud mode, email verification is already confirmed above, so we can safely create the customer
    if (isCloudHosted()) {
      await ensurePolarCustomerAndLink(
        currentUser.id,
        currentUser.email,
        currentUser.name,
        result.organization!.id,
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        organization: result.organization,
        project: result.project,
      },
      message: "Default organization and project created successfully",
    });
  } catch (error) {
    console.error("❌ Failed to create default org/project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to setup defaults" },
      { status: 500 },
    );
  }
}
