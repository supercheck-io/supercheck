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
import { eq, and, gte, desc, asc, sql } from "drizzle-orm";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { randomUUID } from "crypto";
import {
  isCloudHosted,
} from "@/lib/feature-flags";
import { ensurePolarCustomerAndLink } from "@/lib/services/organization-customer";
import { requireSameOriginRequest } from "@/lib/security/same-origin";


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
      .innerJoin(orgTable, eq(member.organizationId, orgTable.id))
      .where(eq(member.userId, currentUser.id))
      .orderBy(asc(orgTable.createdAt), asc(orgTable.id));

    if (existingMemberships.length > 0) {
      // Only the organization owner may establish its Polar customer binding.
      // Invited members also pass through this endpoint; allowing them to relink
      // billing would let an ordinary member replace the organization's customer.
      if (isCloudHosted()) {
        // Preserve legacy memberships and paid bindings, but only provision the
        // default owned organization. Extra accounts require explicit reconciliation.
        const ownedMembership = existingMemberships.find(membership => membership.role === "org_owner");
        if (ownedMembership) {
          await ensurePolarCustomerAndLink(currentUser.id, currentUser.email, currentUser.name, ownedMembership.organizationId);
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

    const sessionData = await auth.api.getSession({ headers: await headers() });
    if (!sessionData?.session?.token) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    // Use a transaction to atomically check and create org/member/project
    // This prevents race conditions where multiple concurrent calls could create duplicate orgs
    const result = await db.transaction(async (tx) => {
      // Serialize signup and invitation acceptance for this user.
      const [lockedUser] = await tx.select({ id: userTable.id }).from(userTable)
        .where(eq(userTable.id, currentUser.id)).limit(1).for("update");
      if (!lockedUser) throw new Error("SESSION_CHANGED");

      // Now safely check if user already has an organization (within the lock)
      const existingMembershipsInTx = await tx
        .select({
          organizationId: member.organizationId,
          role: member.role,
        })
        .from(member)
        .innerJoin(orgTable, eq(member.organizationId, orgTable.id))
        .where(eq(member.userId, currentUser.id))
        .orderBy(asc(orgTable.createdAt), asc(orgTable.id));

      if (existingMembershipsInTx.length > 0) {
        // Another call already created or joined an organization.
        // Repair billing only if the assigned organization is owned.
        return {
          existed: true as const,
          ownedOrganizationId: existingMembershipsInTx.find(membership => membership.role === "org_owner")?.organizationId ?? null,
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

      // Select both defaults before releasing the user lock.
      const [updated] = await tx.update(session)
        .set({ activeOrganizationId: newOrg.id, activeProjectId: newProject.id })
        .where(and(eq(session.token, sessionData.session.token), eq(session.userId, currentUser.id)))
        .returning({ id: session.id });
      if (!updated) throw new Error("SESSION_CHANGED");

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
        if (result.ownedOrganizationId) {
          await ensurePolarCustomerAndLink(currentUser.id, currentUser.email, currentUser.name, result.ownedOrganizationId);
        }
      }
      return NextResponse.json({
        success: true,
        message: "Organization already created by concurrent call",
      });
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
    if (error instanceof Error && error.message === "SESSION_CHANGED") {
      return NextResponse.json({ success: false, error: "Session changed. Please sign in again." }, { status: 401 });
    }
    console.error("❌ Failed to create default org/project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to setup defaults" },
      { status: 500 },
    );
  }
}
