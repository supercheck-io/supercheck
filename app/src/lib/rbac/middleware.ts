/**
 * Unified RBAC Middleware System
 *
 * Single source of truth for:
 * - Permission checking (server & client)
 * - Permission enforcement on API routes
 * - Authentication middleware
 * - Rate limiting
 *
 * This replaces both middleware.ts and permission-middleware.ts following DRY principle
 */

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/utils/db";
import { member, projectMembers, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/utils/auth";
import {
  Role,
  hasPermission as checkPermission,
  PermissionContext,
  statement,
} from "./permissions";
import { normalizeRole } from "./role-normalizer";
import { isSuperAdmin } from "./super-admin";
import { logAuditEvent } from "@/lib/audit-logger";

// ============================================================================
// PERMISSION CHECKING - Core Functions
// ============================================================================

/**
 * Check if a user has a specific permission
 */
export async function hasPermission(
  resource: keyof typeof statement,
  action: string,
  context?: Partial<PermissionContext>
): Promise<boolean> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return false;
    }

    // Use Better Auth's hasPermission API for organization and admin permissions
    if (["organization", "member", "invitation"].includes(resource)) {
      const result = await auth.api.hasPermission({
        headers: await headers(),
        body: {
          permissions: {
            [resource]: [action],
          },
        },
      });
      return result.success;
    }

    // For custom resources, use our custom logic
    const userRole = await getUserRole(session.user.id, context?.organizationId);
    const assignedProjects =
      context?.assignedProjectIds ||
      (await getUserAssignedProjects(session.user.id));

    const permissionContext: PermissionContext = {
      userId: session.user.id,
      role: userRole,
      organizationId: context?.organizationId,
      projectId: context?.projectId,
      assignedProjectIds: assignedProjects,
      resourceCreatorId: context?.resourceCreatorId,
    };

    return checkPermission(permissionContext, resource, action);
  } catch (error) {
    console.error("Error checking permission:", error);
    return false;
  }
}

// ============================================================================
// VARIABLE PERMISSIONS - Using unified role-based model (same as tests/jobs)
// ============================================================================

/**
 * Check if user can view project variables
 * Admin+ roles can always view, editors+ can view in assigned projects, viewers can view
 */
export async function canViewVariables(
  userId: string,
  projectId: string
): Promise<boolean> {
  try {
    const userRole = await getUserRole(userId);
    const permissionContext: PermissionContext = {
      userId,
      role: userRole,
      projectId,
      assignedProjectIds: await getUserAssignedProjects(userId),
    };
    return checkPermission(permissionContext, "variable", "view");
  } catch {
    return false;
  }
}

/**
 * Check if user can create variables
 * Editors+ (ORG_ADMIN, ORG_OWNER, PROJECT_ADMIN, PROJECT_EDITOR) can create
 */
export async function canCreateVariables(
  userId: string,
  projectId: string
): Promise<boolean> {
  try {
    const userRole = await getUserRole(userId);
    const permissionContext: PermissionContext = {
      userId,
      role: userRole,
      projectId,
      assignedProjectIds: await getUserAssignedProjects(userId),
    };
    return checkPermission(permissionContext, "variable", "create");
  } catch {
    return false;
  }
}

/**
 * Check if user can update variables
 * Editors+ can update in assigned projects or for org-level roles
 */
export async function canUpdateVariables(
  userId: string,
  projectId: string
): Promise<boolean> {
  try {
    const userRole = await getUserRole(userId);
    const permissionContext: PermissionContext = {
      userId,
      role: userRole,
      projectId,
      assignedProjectIds: await getUserAssignedProjects(userId),
    };
    return checkPermission(permissionContext, "variable", "update");
  } catch {
    return false;
  }
}

/**
 * Check if user can delete variables
 * Only PROJECT_ADMIN+ and org-level admins can delete
 */
export async function canDeleteVariables(
  userId: string,
  projectId: string
): Promise<boolean> {
  try {
    const userRole = await getUserRole(userId);
    const permissionContext: PermissionContext = {
      userId,
      role: userRole,
      projectId,
      assignedProjectIds: await getUserAssignedProjects(userId),
    };
    return checkPermission(permissionContext, "variable", "delete");
  } catch {
    return false;
  }
}

/**
 * Check if user can view secret values
 * Only PROJECT_ADMIN+ and org-level admins can view secrets
 */
export async function canViewSecretVariables(
  userId: string,
  projectId: string
): Promise<boolean> {
  try {
    const userRole = await getUserRole(userId);
    const permissionContext: PermissionContext = {
      userId,
      role: userRole,
      projectId,
      assignedProjectIds: await getUserAssignedProjects(userId),
    };
    return checkPermission(permissionContext, "variable", "view_secrets");
  } catch {
    return false;
  }
}

// ============================================================================
// ORGANIZATION-AWARE VARIABLE PERMISSIONS
// These are the correct functions to use in API routes as they get org context
// ============================================================================

/**
 * Check if user can create variables in a project (with organization context)
 * Used in API routes to ensure proper role checking with organization context
 *
 * Permission rules:
 * - ORG_OWNER/ORG_ADMIN can create in any project of their organization
 * - PROJECT_ADMIN/PROJECT_EDITOR can create in their assigned projects
 * - PROJECT_VIEWER cannot create
 */
export async function canCreateVariableInProject(
  userId: string,
  projectId: string
): Promise<boolean> {
  try {
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return false;
    }

    // Check organization role first
    const userRole = await getUserOrgRole(userId, project[0].organizationId);
    if (userRole === Role.ORG_OWNER || userRole === Role.ORG_ADMIN) {
      return true; // Org-level admins can create in any project
    }

    // For other roles, check project-level membership
    const projectMember = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .limit(1);

    if (!projectMember.length) {
      return false; // User is not a member of this project
    }

    const projectRole = projectMember[0].role;
    return (
      projectRole === Role.PROJECT_ADMIN ||
      projectRole === Role.PROJECT_EDITOR
    );
  } catch {
    return false;
  }
}

/**
 * Check if user can update variables in a project (with organization context)
 * Used in API routes to ensure proper role checking with organization context
 *
 * Permission rules:
 * - ORG_OWNER/ORG_ADMIN can update in any project of their organization
 * - PROJECT_ADMIN/PROJECT_EDITOR can update in their assigned projects
 * - PROJECT_VIEWER cannot update
 */
export async function canUpdateVariableInProject(
  userId: string,
  projectId: string
): Promise<boolean> {
  try {
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return false;
    }

    // Check organization role first
    const userRole = await getUserOrgRole(userId, project[0].organizationId);
    if (userRole === Role.ORG_OWNER || userRole === Role.ORG_ADMIN) {
      return true; // Org-level admins can update in any project
    }

    // For other roles, check project-level membership
    const projectMember = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .limit(1);

    if (!projectMember.length) {
      return false; // User is not a member of this project
    }

    const projectRole = projectMember[0].role;
    return (
      projectRole === Role.PROJECT_ADMIN ||
      projectRole === Role.PROJECT_EDITOR
    );
  } catch {
    return false;
  }
}

/**
 * Check if user can delete variables in a project (with organization context)
 * Used in API routes to ensure proper role checking with organization context
 *
 * Permission rules:
 * - ORG_OWNER/ORG_ADMIN can delete in any project of their organization
 * - PROJECT_ADMIN can delete in their assigned projects
 * - PROJECT_EDITOR and PROJECT_VIEWER cannot delete
 */
export async function canDeleteVariableInProject(
  userId: string,
  projectId: string
): Promise<boolean> {
  try {
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return false;
    }

    // Check organization role first
    const userRole = await getUserOrgRole(userId, project[0].organizationId);
    if (userRole === Role.ORG_OWNER || userRole === Role.ORG_ADMIN) {
      return true; // Org-level admins can delete in any project
    }

    // For other roles, check project-level membership
    const projectMember = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .limit(1);

    if (!projectMember.length) {
      return false; // User is not a member of this project
    }

    const projectRole = projectMember[0].role;
    return projectRole === Role.PROJECT_ADMIN; // Only PROJECT_ADMIN can delete
  } catch {
    return false;
  }
}

/**
 * Check if user can view secret variables in a project (with organization context)
 * Used in API routes to ensure proper role checking with organization context
 *
 * Permission rules:
 * - ORG_OWNER/ORG_ADMIN can view secrets in any project of their organization
 * - PROJECT_ADMIN/PROJECT_EDITOR can view secrets in their assigned projects
 * - PROJECT_VIEWER cannot view secrets
 */
export async function canViewSecretVariableInProject(
  userId: string,
  projectId: string
): Promise<boolean> {
  try {
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return false;
    }

    // Check organization role first
    const userRole = await getUserOrgRole(userId, project[0].organizationId);
    if (userRole === Role.ORG_OWNER || userRole === Role.ORG_ADMIN) {
      return true; // Org-level admins can view secrets in any project
    }

    // For other roles, check project-level membership
    const projectMember = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .limit(1);

    if (!projectMember.length) {
      return false; // User is not a member of this project
    }

    const projectRole = projectMember[0].role;
    return (
      projectRole === Role.PROJECT_ADMIN ||
      projectRole === Role.PROJECT_EDITOR
    );
  } catch {
    return false;
  }
}

/**
 * DEPRECATED: Use canDeleteVariables instead
 */
export async function canManageProjectVariables(
  userId: string,
  projectId: string
): Promise<boolean> {
  return canDeleteVariables(userId, projectId);
}

/**
 * DEPRECATED: Use canCreateVariables instead
 */
export async function canCreateEditProjectVariables(
  userId: string,
  projectId: string
): Promise<boolean> {
  return canCreateVariables(userId, projectId);
}

/**
 * DEPRECATED: Use canDeleteVariables instead
 */
export async function canDeleteProjectVariables(
  userId: string,
  projectId: string
): Promise<boolean> {
  return canDeleteVariables(userId, projectId);
}

// ============================================================================
// REQUIRE FUNCTIONS - Throw error if not authorized
// ============================================================================

/**
 * Require a specific permission - throws error if not authorized
 */
export async function requirePermission(
  resource: keyof typeof statement,
  action: string,
  context?: Partial<PermissionContext>
): Promise<void> {
  const hasAccess = await hasPermission(resource, action, context);

  if (!hasAccess) {
    throw new Error(`Access denied: Missing permission ${resource}:${action}`);
  }
}

/**
 * Require permissions for multiple resources
 */
export async function requirePermissions(
  permissions: Record<string, string[]>,
  context?: { organizationId?: string; projectId?: string }
): Promise<{ userId: string; user: SessionUser }> {
  const authResult = await requireAuth();

  try {
    for (const [resource, actions] of Object.entries(permissions)) {
      if (
        ["organization", "member", "invitation", "user", "session"].includes(
          resource
        )
      ) {
        const result = await auth.api.hasPermission({
          headers: await headers(),
          body: {
            permissions: {
              [resource]: actions,
            },
          },
        });

        if (!result.success) {
          throw new Error(`Access denied: Missing ${resource} permissions`);
        }
      } else {
        for (const action of actions) {
          const hasAccess = await hasPermission(
            resource as keyof typeof statement,
            action,
            context
          );
          if (!hasAccess) {
            throw new Error(
              `Access denied: Missing ${resource}:${action} permission`
            );
          }
        }
      }
    }

    return authResult;
  } catch (error) {
    throw new Error(
      `Permission check failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Require authentication
 */
export async function requireAuth(): Promise<{
  userId: string;
  user: SessionUser;
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Authentication required");
  }

  return {
    userId: session.user.id,
    user: session.user,
  };
}

/**
 * Require super admin privileges
 */
export async function requireSuperAdmin(): Promise<{
  userId: string;
  error?: string;
}> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return { userId: "", error: "Authentication required" };
    }

    const isSA = await isSuperAdmin(session.user.id);
    if (!isSA) {
      return { userId: "", error: "Super admin privileges required" };
    }

    return { userId: session.user.id };
  } catch (error) {
    console.error("Error in requireSuperAdmin:", error);
    return { userId: "", error: "Authentication failed" };
  }
}

// ============================================================================
// ROLE RETRIEVAL
// ============================================================================

/**
 * Get user's role (prioritizes organization membership role)
 */
export async function getUserRole(
  userId: string,
  organizationId?: string
): Promise<Role> {
  const isSA = await isSuperAdmin(userId);
  if (isSA) {
    return Role.SUPER_ADMIN;
  }

  if (organizationId) {
    const orgRole = await getUserOrgRole(userId, organizationId);
    if (orgRole) return orgRole;
  }

  return Role.PROJECT_VIEWER;
}

/**
 * Get user's organization role
 */
export async function getUserOrgRole(
  userId: string,
  organizationId: string
): Promise<Role | null> {
  const memberRecord = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId))
    )
    .limit(1);

  if (memberRecord.length === 0) {
    return null;
  }

  return normalizeRole(memberRecord[0].role);
}

/**
 * Get user's assigned project IDs
 */
export async function getUserAssignedProjects(
  userId: string
): Promise<string[]> {
  const projectAssignments = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));

  return projectAssignments.map((p) => p.projectId);
}

/**
 * Build permission context
 */
export async function buildPermissionContext(
  userId: string,
  organizationId?: string,
  projectId?: string
): Promise<PermissionContext> {
  const role = await getUserRole(userId, organizationId);
  const assignedProjectIds =
    role === Role.PROJECT_EDITOR || role === Role.PROJECT_ADMIN
      ? await getUserAssignedProjects(userId)
      : [];

  return {
    userId,
    role,
    organizationId,
    projectId,
    assignedProjectIds,
  };
}

// ============================================================================
// USER SESSION TYPE
// ============================================================================

export interface SessionUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | null;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
}

// ============================================================================
// PERMISSION DEFINITION FOR API ROUTES
// ============================================================================

export interface ApiPermission {
  resource: keyof typeof statement;
  actions: string[];
  context?: {
    organizationId?: string;
    projectId?: string;
    resourceCreatorId?: string;
  };
}

// ============================================================================
// MIDDLEWARE WRAPPERS FOR API ROUTES
// ============================================================================

/**
 * Generic middleware to enforce permissions on API routes
 */
export function withPermissions(
  permissions: ApiPermission | ApiPermission[],
  options: {
    requireAll?: boolean;
    auditAction?: string;
  } = {}
) {
  return async (
    req: NextRequest,
    handler: (
      req: NextRequest,
      context: { userId: string; user: Record<string, unknown> }
    ) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    const startTime = Date.now();
    let userId: string | undefined;
    let hasAccess = false;

    try {
      const authResult = await requireAuth();
      userId = authResult.userId;

      const permissionArray = Array.isArray(permissions)
        ? permissions
        : [permissions];

      const permissionResults = await Promise.all(
        permissionArray.map(async (permission) => {
          const result = await hasPermission(
            permission.resource,
            permission.actions[0],
            permission.context
          );
          return result;
        })
      );

      hasAccess = options.requireAll
        ? permissionResults.every((result) => result)
        : permissionResults.some((result) => result);

      if (!hasAccess) {
        await logAuditEvent({
          userId,
          action: options.auditAction || "unauthorized_access_attempt",
          resource: permissionArray[0]?.resource || "unknown",
          metadata: {
            url: req.url,
            method: req.method,
            permissions: permissionArray,
            userAgent: req.headers.get("user-agent"),
            ip:
              req.headers.get("x-forwarded-for") ||
              req.headers.get("x-real-ip"),
          },
          success: false,
        });

        return NextResponse.json(
          { error: "Access denied: Insufficient permissions" },
          { status: 403 }
        );
      }

      await logAuditEvent({
        userId,
        action: options.auditAction || "api_access",
        resource: permissionArray[0]?.resource || "unknown",
        metadata: {
          url: req.url,
          method: req.method,
          duration: Date.now() - startTime,
        },
        success: true,
      });

      return await handler(req, {
        userId,
        user: authResult.user as unknown as Record<string, unknown>,
      });
    } catch (error) {
      if (userId) {
        await logAuditEvent({
          userId,
          action: "api_error",
          resource: "unknown",
          metadata: {
            url: req.url,
            method: req.method,
            error: error instanceof Error ? error.message : "Unknown error",
            duration: Date.now() - startTime,
          },
          success: false,
        });
      }

      console.error("Permission middleware error:", error);

      if (error instanceof Error) {
        if (error.message === "Authentication required") {
          return NextResponse.json(
            { error: "Authentication required" },
            { status: 401 }
          );
        }

        if (error.message.includes("Access denied")) {
          return NextResponse.json({ error: error.message }, { status: 403 });
        }
      }

      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

// ============================================================================
// SPECIALIZED MIDDLEWARE FOR SPECIFIC RESOURCES
// ============================================================================

export function withOrganizationPermission(
  action: string,
  options: { auditAction?: string } = {}
) {
  return withPermissions(
    {
      resource: "organization",
      actions: [action],
      context: {},
    },
    options
  );
}

export function withProjectPermission(
  action: string,
  getProjectId: (req: NextRequest) => string | Promise<string>,
  options: { auditAction?: string } = {}
) {
  return async (
    req: NextRequest,
    handler: (
      req: NextRequest,
      context: { userId: string; user: Record<string, unknown> }
    ) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    const projectId = await getProjectId(req);

    return withPermissions(
      {
        resource: "project",
        actions: [action],
        context: { projectId },
      },
      options
    )(req, handler);
  };
}

export function withTestPermission(
  action: string,
  getProjectId: (req: NextRequest) => string | Promise<string>,
  options: { auditAction?: string } = {}
) {
  return async (
    req: NextRequest,
    handler: (
      req: NextRequest,
      context: { userId: string; user: Record<string, unknown> }
    ) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    const projectId = await getProjectId(req);

    return withPermissions(
      {
        resource: "test",
        actions: [action],
        context: { projectId },
      },
      options
    )(req, handler);
  };
}

export function withJobPermission(
  action: string,
  getProjectId: (req: NextRequest) => string | Promise<string>,
  options: { auditAction?: string } = {}
) {
  return async (
    req: NextRequest,
    handler: (
      req: NextRequest,
      context: { userId: string; user: Record<string, unknown> }
    ) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    const projectId = await getProjectId(req);

    return withPermissions(
      {
        resource: "job",
        actions: [action],
        context: { projectId },
      },
      options
    )(req, handler);
  };
}

export function withMonitorPermission(
  action: string,
  getProjectId: (req: NextRequest) => string | Promise<string>,
  options: { auditAction?: string } = {}
) {
  return async (
    req: NextRequest,
    handler: (
      req: NextRequest,
      context: { userId: string; user: Record<string, unknown> }
    ) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    const projectId = await getProjectId(req);

    return withPermissions(
      {
        resource: "monitor",
        actions: [action],
        context: { projectId },
      },
      options
    )(req, handler);
  };
}

export function withVariablePermission(
  action: string,
  getProjectId: (req: NextRequest) => string | Promise<string>,
  options: { auditAction?: string } = {}
) {
  return async (
    req: NextRequest,
    handler: (
      req: NextRequest,
      context: { userId: string; user: Record<string, unknown> }
    ) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    const projectId = await getProjectId(req);

    return withPermissions(
      {
        resource: "variable",
        actions: [action],
        context: { projectId },
      },
      options
    )(req, handler);
  };
}

export function withApiKeyPermission(
  action: string,
  getProjectId: (req: NextRequest) => string | Promise<string>,
  options: { auditAction?: string } = {}
) {
  return async (
    req: NextRequest,
    handler: (
      req: NextRequest,
      context: { userId: string; user: Record<string, unknown> }
    ) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    const projectId = await getProjectId(req);

    return withPermissions(
      {
        resource: "apiKey",
        actions: [action],
        context: { projectId },
      },
      options
    )(req, handler);
  };
}

export function withSystemAdminPermission(
  action: string,
  options: { auditAction?: string } = {}
) {
  return withPermissions(
    {
      resource: "system",
      actions: [action],
      context: {},
    },
    options
  );
}

// ============================================================================
// RATE LIMITING MIDDLEWARE
// ============================================================================

export function withRateLimit(
  maxRequests: number,
  windowMs: number,
  options: { auditAction?: string } = {}
) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return async (
    req: NextRequest,
    handler: (
      req: NextRequest,
      context: { userId: string; user: Record<string, unknown> }
    ) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    const clientId =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const now = Date.now();
    const clientRequests = requests.get(clientId);

    if (clientRequests) {
      if (now > clientRequests.resetTime) {
        clientRequests.count = 1;
        clientRequests.resetTime = now + windowMs;
      } else if (clientRequests.count >= maxRequests) {
        await logAuditEvent({
          userId: "anonymous",
          action: options.auditAction || "rate_limit_exceeded",
          resource: "api",
          metadata: {
            clientId,
            url: req.url,
            method: req.method,
          },
          success: false,
        });

        return NextResponse.json(
          { error: "Too many requests" },
          { status: 429 }
        );
      } else {
        clientRequests.count++;
      }
    } else {
      requests.set(clientId, {
        count: 1,
        resetTime: now + windowMs,
      });
    }

    // Cleanup old entries
    if (Math.random() < 0.01) {
      for (const [key, value] of requests.entries()) {
        if (now > value.resetTime) {
          requests.delete(key);
        }
      }
    }

    // Get auth context if available, else use anonymous
    try {
      const authResult = await requireAuth();
      return await handler(req, {
        userId: authResult.userId,
        user: authResult.user as unknown as Record<string, unknown>,
      });
    } catch {
      // Allow anonymous rate limiting
      return await handler(req, {
        userId: "anonymous",
        user: {} as Record<string, unknown>,
      });
    }
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function getProjectIdFromParams(params: { id: string }): string {
  return params.id;
}

export function getProjectIdFromUrl(req: NextRequest): string | null {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");

  const projectsIndex = pathParts.indexOf("projects");
  if (projectsIndex !== -1 && pathParts.length > projectsIndex + 1) {
    return pathParts[projectsIndex + 1];
  }

  return null;
}

// ============================================================================
// ADMIN HELPERS
// ============================================================================

export async function isAdmin(organizationId?: string): Promise<boolean> {
  try {
    if (organizationId) {
      const result = await auth.api.hasPermission({
        headers: await headers(),
        body: {
          permissions: {
            organization: ["update"],
            member: ["create", "update", "delete"],
          },
        },
      });
      return result.success;
    }

    return await hasPermission("system", "manage_users");
  } catch {
    return false;
  }
}

export async function canEditProject(
  organizationId: string,
  projectId: string
): Promise<boolean> {
  return hasPermission("test", "update", { organizationId, projectId });
}

export async function canViewProject(
  organizationId: string,
  projectId: string
): Promise<boolean> {
  return hasPermission("project", "view", { organizationId, projectId });
}

export async function canPerformAdminOperation(
  operation:
    | "manage_users"
    | "view_users"
    | "impersonate_users"
    | "manage_organizations"
): Promise<boolean> {
  try {
    const result = await auth.api.userHasPermission({
      body: {
        permissions: {
          system: [operation],
        },
      },
    });
    if (result.error) {
      console.error("Admin permission check failed:", result.error);
      return false;
    }
    return result.success;
  } catch (error) {
    console.error("Admin permission check failed:", error);
    return false;
  }
}
