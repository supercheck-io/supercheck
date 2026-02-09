/**
 * Clean Session-Based Project Context
 * No URL parameters, pure server-side session management
 */

import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { db } from "@/utils/db";
import {
  projects,
  projectMembers,
  session as sessionTable,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getActiveOrganization,
  getUserProjects,
  getCurrentUser,
} from "./session";
import { getUserOrgRole } from "./rbac/middleware";
import { Role } from "./rbac/permissions";
import { roleToString } from "./rbac/role-normalizer";
import { getCachedAuthSession } from "./session-cache";
import { getUnifiedAuthContext } from "./rbac/unified-auth";

// getCachedAuthSession imported from session-cache.ts (DRY principle)

export interface ProjectContext {
  id: string;
  name: string;
  slug?: string;
  organizationId: string;
  isDefault: boolean;
  userRole: string;
}

/**
 * Get current project context from session - single source of truth
 */
export async function getCurrentProjectContext(): Promise<ProjectContext | null> {
  try {
    // Use cached session to avoid duplicate DB round-trips in Docker
    const sessionData = await getCachedAuthSession();

    if (!sessionData?.session?.token || !sessionData?.user?.id) {
      return null;
    }

    // Query the session table directly to get the activeProjectId and check for impersonation
    const sessionRecord = await db
      .select({
        activeProjectId: sessionTable.activeProjectId,
        userId: sessionTable.userId,
        impersonatedBy: sessionTable.impersonatedBy,
      })
      .from(sessionTable)
      .where(eq(sessionTable.token, sessionData.session.token))
      .limit(1);

    if (sessionRecord.length === 0) {
      return null;
    }

    const session = sessionRecord[0];

    // Use the impersonated user ID if impersonation is active, otherwise use the original user ID
    const currentUserId = session.impersonatedBy
      ? session.userId
      : sessionData.user.id;

    const activeProjectId = session.activeProjectId;

    if (!activeProjectId) {
      // No active project in session, try to set a default
      return await setDefaultProjectInSession();
    }

    const projectData = await db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        organizationId: projects.organizationId,
        isDefault: projects.isDefault,
      })
      .from(projects)
      .where(
        and(eq(projects.id, activeProjectId), eq(projects.status, "active"))
      )
      .limit(1);

    if (projectData.length === 0) {
      return await setDefaultProjectInSession();
    }

    const project = projectData[0];

    // Get user's role using consistent role resolution
    // 1. First check organization role (primary source of truth)
    const orgRole = await getUserOrgRole(currentUserId, project.organizationId);

    if (!orgRole) {
      return await setDefaultProjectInSession();
    }

    // 2. For PROJECT_ADMIN and PROJECT_EDITOR, check project-specific access
    let finalRole = orgRole;
    if (orgRole === Role.PROJECT_ADMIN || orgRole === Role.PROJECT_EDITOR) {
      const projectMember = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, activeProjectId),
            eq(projectMembers.userId, currentUserId)
          )
        )
        .limit(1);

      if (projectMember.length === 0) {
        // For project-limited roles without assignments, give viewer access
        finalRole = Role.PROJECT_VIEWER;
      } else {
        // Keep the org role as final role when assigned to this project
        finalRole = orgRole;
      }
    }

    // 3. Convert Role enum back to string using the normalizer
    const roleString = roleToString(finalRole);

    return {
      id: project.id,
      name: project.name,
      slug: project.slug || undefined,
      organizationId: project.organizationId,
      isDefault: project.isDefault,
      userRole: roleString,
    };
  } catch (error) {
    console.error("Error getting project context:", error);
    return null;
  }
}

/**
 * Set a default project in session when no active project exists
 */
async function setDefaultProjectInSession(): Promise<ProjectContext | null> {
  try {
    // Use cached session to avoid duplicate DB round-trips in Docker
    const sessionData = await getCachedAuthSession();

    if (!sessionData?.session?.token || !sessionData?.user?.id) {
      return null;
    }

    // Get current user (handles impersonation)
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return null;
    }

    const activeOrg = await getActiveOrganization();
    if (!activeOrg) {
      return null;
    }

    const userProjects = await getUserProjects(currentUser.id, activeOrg.id);
    if (userProjects.length === 0) {
      // User has no projects in this organization
      // Try to find any active project in the organization and request access
      const orgProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
          organizationId: projects.organizationId,
          isDefault: projects.isDefault,
        })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, activeOrg.id),
            eq(projects.status, "active")
          )
        )
        .limit(1);

      if (orgProjects.length > 0) {
        // Check if user already has access to any project in this organization first
        const existingAccess = await db
          .select({ projectId: projectMembers.projectId })
          .from(projectMembers)
          .innerJoin(projects, eq(projectMembers.projectId, projects.id))
          .where(
            and(
              eq(projectMembers.userId, currentUser.id),
              eq(projects.organizationId, activeOrg.id),
              eq(projects.status, "active")
            )
          )
          .limit(1);

        // If user already has project access, they might have been added via invitation
        // Don't auto-assign - wait for proper project context to be established
        if (existingAccess.length > 0) {
          console.log(
            `ℹ️ User ${currentUser.email} already has project access in organization "${activeOrg.name}" - skipping auto-assignment`
          );
          return null;
        }

        // Auto-assign user to the first available project (usually the default)
        const projectToAssign = orgProjects[0];

        try {
          await db.insert(projectMembers).values({
            userId: currentUser.id,
            projectId: projectToAssign.id,
            role: "project_viewer", // Default to project viewer role
            createdAt: new Date(),
          });

          console.log(
            `✅ Auto-assigned user ${currentUser.email} to project "${projectToAssign.name}" in organization "${activeOrg.name}"`
          );

          // Update session with this project
          await db
            .update(sessionTable)
            .set({ activeProjectId: projectToAssign.id })
            .where(eq(sessionTable.token, sessionData.session.token));

          return {
            id: projectToAssign.id,
            name: projectToAssign.name,
            slug: projectToAssign.slug || undefined,
            organizationId: projectToAssign.organizationId,
            isDefault: projectToAssign.isDefault,
            userRole: "project_viewer",
          };
        } catch (error: unknown) {
          // Handle duplicate key constraint violation gracefully
          const dbError = error as {
            constraint?: string;
            code?: string;
            message?: string;
          };
          if (
            dbError?.constraint === "project_members_uniqueUserProject" ||
            dbError?.code === "23505" ||
            dbError?.message?.includes("duplicate key")
          ) {
            console.log(
              `ℹ️ User ${currentUser.email} was already assigned to project "${projectToAssign.name}" (likely via invitation)`
            );

            // Update session anyway since they do have access
            await db
              .update(sessionTable)
              .set({ activeProjectId: projectToAssign.id })
              .where(eq(sessionTable.token, sessionData.session.token));

            return {
              id: projectToAssign.id,
              name: projectToAssign.name,
              slug: projectToAssign.slug || undefined,
              organizationId: projectToAssign.organizationId,
              isDefault: projectToAssign.isDefault,
              userRole: "project_viewer",
            };
          }

          console.error("Error auto-assigning user to project:", error);
          return null;
        }
      }

      return null;
    }

    // Find default project or use first project
    const defaultProject =
      userProjects.find((p) => p.isDefault) || userProjects[0];

    // Update session with this project
    await db
      .update(sessionTable)
      .set({ activeProjectId: defaultProject.id })
      .where(eq(sessionTable.token, sessionData.session.token));

    return {
      id: defaultProject.id,
      name: defaultProject.name,
      slug: defaultProject.slug || undefined,
      organizationId: defaultProject.organizationId,
      isDefault: defaultProject.isDefault,
      userRole: defaultProject.role || "project_viewer",
    };
  } catch (error) {
    console.error("Error setting default project:", error);
    return null;
  }
}

/**
 * Switch to a different project (updates session)
 */
export async function switchProject(
  projectId: string
): Promise<{ success: boolean; message?: string; project?: ProjectContext }> {
  try {
    // Use cached session to avoid duplicate DB round-trips in Docker
    const sessionData = await getCachedAuthSession();

    if (!sessionData?.session?.token || !sessionData?.user?.id) {
      return { success: false, message: "Not authenticated" };
    }

    // Get current user (handles impersonation)
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, message: "Not authenticated" };
    }

    const activeOrg = await getActiveOrganization();
    if (!activeOrg) {
      return { success: false, message: "No active organization" };
    }

    // Verify user has access to this project
    const userProjects = await getUserProjects(currentUser.id, activeOrg.id);
    const targetProject = userProjects.find((p) => p.id === projectId);

    if (!targetProject) {
      return { success: false, message: "Project not found or access denied" };
    }

    // Update session
    const updateResult = await db
      .update(sessionTable)
      .set({ activeProjectId: projectId })
      .where(eq(sessionTable.token, sessionData.session.token))
      .returning({ activeProjectId: sessionTable.activeProjectId });

    if (updateResult.length === 0) {
      return {
        success: false,
        message: "Failed to update session - please try logging in again",
      };
    }

    // Verify the update worked by reading it back
    const verifySession = await db
      .select({ activeProjectId: sessionTable.activeProjectId })
      .from(sessionTable)
      .where(eq(sessionTable.token, sessionData.session.token))
      .limit(1);

    if (
      verifySession.length === 0 ||
      verifySession[0].activeProjectId !== projectId
    ) {
      return {
        success: false,
        message: "Session update failed - please try again",
      };
    }

    const projectContext: ProjectContext = {
      id: targetProject.id,
      name: targetProject.name,
      slug: targetProject.slug || undefined,
      organizationId: targetProject.organizationId,
      isDefault: targetProject.isDefault,
      userRole: targetProject.role || "project_viewer",
    };

    return {
      success: true,
      message: `Switched to ${targetProject.name}`,
      project: projectContext,
    };
  } catch (error) {
    console.error("Error switching project:", error);
    return { success: false, message: "Failed to switch project" };
  }
}

/**
 * Require project context middleware for API routes
 */
export async function requireProjectContext(): Promise<{
  userId: string;
  project: ProjectContext;
  organizationId: string;
}> {
  // Use cached session to avoid duplicate DB round-trips
  const sessionData = await getCachedAuthSession();
  
  if (!sessionData?.session?.token) {
    throw new Error("Authentication required");
  }

  // Check for project override header
  const headersList = await headers();
  const requestedProjectId = headersList.get("x-project-id");

  // Use optimization unified query (1 DB call instead of 6-10)
  const ctx = await getUnifiedAuthContext(sessionData.session.token, requestedProjectId);

  if (!ctx.isValid) {
     throw new Error(ctx.error || "Authentication failed");
  }

  if (!ctx.projectId || !ctx.organizationId) {
     // Fallback: If unified query didn't find project, try the old (slow) way 
     // which handles default project creation logic
     // This ensures we don't break "first login" flow while optimizing standard flow
     const slowProject = await getCurrentProjectContext();
     if (!slowProject) {
        throw new Error(
          "No active project found. Please ensure you have access to at least one project."
        );
     }
     
     // Get session again to be safe about user ID (impersonation)
     // getCurrentUser() was called inside old flow potentially, but let's just use what we have
     // We know validity from ctx.isValid check above basically
     const userId = ctx.userId; // unified auth handles impersonation
     
     return {
        userId,
        project: slowProject,
        organizationId: slowProject.organizationId
     };
  }

  return {
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    project: {
        id: ctx.projectId,
        name: ctx.projectName || "Unknown Project",
        slug: undefined, // slug not strictly required for API context usually, adds query overhead
        organizationId: ctx.organizationId,
        isDefault: ctx.isDefaultProject || false,
        // IMPORTANT: Org role takes precedence over project role in RBAC hierarchy
        // Org admins/owners may not have explicit project_members rows but still have full access
        userRole: ctx.organizationRole || ctx.projectRole || "project_viewer", 
    },
  };
}
