import { db } from "@/utils/db";
import { session, user, member, projects, projectMembers, organization } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { normalizeRole } from "./role-normalizer";

type UnifiedAuthContext = {
  // Session / User
  userId: string;
  userEmail?: string | null;
  impersonatedBy: string | null;
  // Project
  projectId: string | null;
  projectName: string | null;
  projectRole: string | null;
  isDefaultProject: boolean | null;
  // Organization
  organizationId: string | null;
  organizationSlug: string | null;
  organizationRole: string | null;
  subscriptionStatus: string | null;
  polarCustomerId: string | null;
  // Valid?
  isValid: boolean;
  error?: string;
};

/**
 * optimized one-shot query to get all auth context
 * Replaces: getSession -> getCurrentProjectContext -> getUserRole -> etc
 */
export async function getUnifiedAuthContext(
  token: string, 
  requestedProjectId?: string | null
): Promise<UnifiedAuthContext> {
  if (!token) {
    return {
      isValid: false,
      userId: "",
      impersonatedBy: null,
      projectId: null,
      projectName: null,
      projectRole: null,
      isDefaultProject: null,
      organizationId: null,
      organizationSlug: null,
      organizationRole: null,
      subscriptionStatus: null,
      polarCustomerId: null,
      error: "No token provided",
    };
  }

  try {
    // 1. Fetch Session + Basic User Info
    const sessionResult = await db
      .select({
        userId: session.userId,
        activeProjectId: session.activeProjectId,
        activeOrgId: session.activeOrganizationId,
        impersonatedBy: session.impersonatedBy,
        email: user.email,
        banned: user.banned,
      })
      .from(session)
      .leftJoin(user, eq(session.userId, user.id))
      .where(eq(session.token, token))
      .limit(1);

    const s = sessionResult[0];

    if (!s) {
      return {
        isValid: false,
        userId: "",
        impersonatedBy: null,
        projectId: null,
        projectName: null,
        projectRole: null,
        isDefaultProject: null,
        organizationId: null,
        organizationSlug: null,
        organizationRole: null,
        subscriptionStatus: null,
        polarCustomerId: null,
        error: "Invalid session",
      };
    }

    if (s.banned) {
        return {
          isValid: false,
          userId: s.userId,
          impersonatedBy: null,
          projectId: null,
          projectName: null,
          projectRole: null,
          isDefaultProject: null,
          organizationId: null,
          organizationSlug: null,
          organizationRole: null,
          subscriptionStatus: null,
          polarCustomerId: null,
          error: "User is banned",
        };
    }
    
    // Determine effective Project ID (requested > session > none)
    // Note: We don't default to "default project" here yet, that logic remains in project-context for now
    // to avoid complex conditional SQL. We just resolve what we know.
    const targetProjectId = requestedProjectId || s.activeProjectId;
    
    // 2. Parallel Fetch: Project Details & Roles
    // We can do this in one query using LEFT JOINs
    
    if (targetProjectId) {
       const contextResult = await db
         .select({
            // Project
            projectId: projects.id,
            projectName: projects.name,
            projectIsDefault: projects.isDefault,
            projectOrgId: projects.organizationId,
            // Project Member Role
            projectRole: projectMembers.role,
            // Organization Member Role
            orgRole: member.role,
            // Org Details
            orgSlug: organization.slug,
            subStatus: organization.subscriptionStatus,
            polarId: organization.polarCustomerId
         })
         .from(projects)
         .leftJoin(organization, eq(projects.organizationId, organization.id))
         .leftJoin(
            projectMembers, 
            and(
                eq(projectMembers.projectId, projects.id),
                eq(projectMembers.userId, s.userId)
            )
         )
         .leftJoin(
            member,
            and(
                eq(member.organizationId, projects.organizationId),
                eq(member.userId, s.userId)
            )
         )
         .where(eq(projects.id, targetProjectId))
         .limit(1);

       const ctx = contextResult[0];
       
       if (ctx) {
           // SECURITY: Verify user has organization membership for the project's org.
           // Without this check, a user could pass an x-project-id header for a project
           // in a different organization and get a valid context with null roles,
           // enabling cross-tenant context confusion.
           if (!ctx.orgRole) {
             // Check if the user is a super admin (they bypass org membership)
             const { isSuperAdmin } = await import("./super-admin");
             const isSA = await isSuperAdmin(s.userId);
             if (!isSA) {
               return {
                 isValid: false,
                 userId: s.userId,
                 impersonatedBy: null,
                 projectId: null,
                 projectName: null,
                 projectRole: null,
                 isDefaultProject: null,
                 organizationId: null,
                 organizationSlug: null,
                 organizationRole: null,
                 subscriptionStatus: null,
                 polarCustomerId: null,
                 error: "Not a member of this project's organization",
               };
             }
           }

           return {
               isValid: true,
               userId: s.userId,
               userEmail: s.email,
               impersonatedBy: s.impersonatedBy,
               
               projectId: ctx.projectId,
               projectName: ctx.projectName,
               isDefaultProject: ctx.projectIsDefault,
               projectRole: normalizeRole(ctx.projectRole),
               
               organizationId: ctx.projectOrgId,
               organizationSlug: ctx.orgSlug,
               organizationRole: normalizeRole(ctx.orgRole),
               
               subscriptionStatus: ctx.subStatus,
               polarCustomerId: ctx.polarId
           };
       }
    }
    
    // Fallback if no project context or project not found
    return {
        isValid: true,
        userId: s.userId,
        userEmail: s.email,
        impersonatedBy: s.impersonatedBy,
        projectId: null,
        projectName: null,
        projectRole: null,
        isDefaultProject: null,
        organizationId: s.activeOrgId,
        organizationSlug: null, // Would need another query, but rare case for API routes requiring project
        organizationRole: null,
        subscriptionStatus: null,
        polarCustomerId: null,
    };

  } catch (error) {
    console.error("Unified Auth Error:", error);
    return {
        isValid: false,
        userId: "",
        impersonatedBy: null,
        projectId: null,
        projectName: null,
        projectRole: null,
        isDefaultProject: null,
        organizationId: null,
        organizationSlug: null,
        organizationRole: null,
        subscriptionStatus: null,
        polarCustomerId: null,
        error: "Internal auth error"
    };
  }
}
