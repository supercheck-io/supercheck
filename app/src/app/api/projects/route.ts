import { NextRequest, NextResponse } from "next/server";
import { hasPermissionForUser, getUserRole } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { getSelectableProjects, getUserProjects } from "@/lib/session";
import { getCurrentProjectContext } from "@/lib/project-context";
import { db } from "@/utils/db";
import { projects, projectMembers } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { checkProjectLimit } from "@/lib/middleware/plan-enforcement";
import { insertWithinPlanLimit } from "@/lib/middleware/plan-limit-lock";
import { and, eq, ne, sql } from "drizzle-orm";
import { withMemberCounts } from "@/lib/project-member-counts";
import {
  subscriptionService,
  SubscriptionAccessDeniedError,
} from "@/lib/services/subscription-service";

/**
 * GET /api/projects
 * List all projects for the current user in the active organization
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId: authOrgId, isCliAuth, projectId: tokenProjectId } = await requireUserAuthContext();

    // Get organization ID from query params or use auth context organization
    const { searchParams } = new URL(request.url);
    const includeMemberCounts = searchParams.get("includeMemberCounts") === "1";
    const decorate = <T extends { id: string; organizationId: string }>(list: T[]) =>
      includeMemberCounts ? withMemberCounts(list) : list;
    const organizationId = searchParams.get("organizationId");

    if (isCliAuth && organizationId && organizationId !== authOrgId) {
      return NextResponse.json({ error: "CLI token does not authorize this organization" }, { status: 403 });
    }

    // Browser project selection includes invited teams. CLI enumeration retains
    // its organization scope unless the caller explicitly requests another team.
    // scope=organization (organization admin page) lists only the active organization.
    if (!organizationId && !isCliAuth && searchParams.get("scope") !== "organization") {
      const [userProjects, currentProject] = await Promise.all([
        getSelectableProjects(userId), getCurrentProjectContext(),
      ]);
      return NextResponse.json({ success: true, data: await decorate(userProjects), currentProject });
    }

    let targetOrgId = organizationId;
    if (!targetOrgId) {
      if (!authOrgId) {
        // User has no organization - this is likely a new user
        // Return empty projects array instead of error to trigger setup flow
        return NextResponse.json({
          success: true,
          data: [],
          currentProject: null,
          message: "No organization found - user needs setup",
        });
      }
      targetOrgId = authOrgId;
    }

    const canView = await hasPermissionForUser(userId, "project", "view", {
      organizationId: targetOrgId,
    });

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Get user's projects in the organization
    const userProjects = await getUserProjects(userId, targetOrgId);
    const scopedProjects = isCliAuth && tokenProjectId
      ? userProjects.filter((project) => project.id === tokenProjectId)
      : userProjects;

    // Get current project context
    const currentProject = await getCurrentProjectContext();

    return NextResponse.json({
      success: true,
      data: await decorate(scopedProjects),
      currentProject: currentProject,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Failed to get projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects
 * Create a new project in the organization
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, organizationId: authOrgId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });

    const body = await request.json();
    const { name, slug, description, organizationId } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Project name is required" },
        { status: 400 }
      );
    }

    if (
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > 255 ||
      (slug != null && (typeof slug !== "string" || slug.length > 100)) ||
      (description != null &&
        (typeof description !== "string" || description.length > 2000))
    ) {
      return NextResponse.json(
        { error: "Invalid project name, slug or description" },
        { status: 400 }
      );
    }

    let targetOrgId = organizationId;
    if (!targetOrgId) {
      if (!authOrgId) {
        return NextResponse.json(
          { error: "No active organization found" },
          { status: 400 }
        );
      }
      targetOrgId = authOrgId;
    }

    // Get user role for security
    const userRole = await getUserRole(userId, targetOrgId);

    // Check permission to create projects
    const canCreate = await hasPermissionForUser(userId, "project", "create", {
      organizationId: targetOrgId,
    });
    if (!canCreate) {
      return NextResponse.json(
        { error: "Insufficient permissions to create projects" },
        { status: 403 }
      );
    }

    // SECURITY: Validate subscription before allowing project creation
    await subscriptionService.blockUntilSubscribed(targetOrgId);
    await subscriptionService.requireValidPolarCustomer(targetOrgId);

    // Serialize count -> limit check -> insert per organization so concurrent
    // requests cannot both pass the plan limit.
    const created = await insertWithinPlanLimit({
      organizationId: targetOrgId,
      resource: "projects",
      check: checkProjectLimit,
      countRows: async (tx) => {
        const [row] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(projects)
          .where(and(eq(projects.organizationId, targetOrgId), ne(projects.status, "deleted")));
        return Number(row?.count || 0);
      },
      insert: async (executor) => {
        const [inserted] = await executor
          .insert(projects)
          .values({
            organizationId: targetOrgId,
            name,
            slug: slug || null,
            description: description || null,
            isDefault: false,
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        return inserted;
      },
    });

    if (!created.ok && created.busy) {
      return NextResponse.json(
        { error: "Too many concurrent requests. Please retry shortly." },
        { status: 503, headers: { "Retry-After": "2" } },
      );
    }
    if (!created.ok) {
      console.warn(
        `Project limit reached for organization ${targetOrgId}: ${created.check.error}`
      );
      return NextResponse.json({ error: created.check.error }, { status: 403 });
    }
    const newProject = created.row;

    // Add user as project editor (project ownership is handled by org membership in unified RBAC)
    await db.insert(projectMembers).values({
      userId,
      projectId: newProject.id,
      role: "project_editor",
      createdAt: new Date(),
    });

    // Log the audit event for project creation
    await logAuditEvent({
      userId,
      organizationId: targetOrgId,
      action: "project_created",
      resource: "project",
      resourceId: newProject.id,
      metadata: {
        projectName: newProject.name,
        projectSlug: newProject.slug,
        description: newProject.description,
        organizationId: targetOrgId,
        userRole: userRole,
      },
      success: true,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: newProject.id,
          name: newProject.name,
          slug: newProject.slug,
          description: newProject.description,
          organizationId: newProject.organizationId,
          isDefault: newProject.isDefault,
          status: newProject.status,
          createdAt: newProject.createdAt,
          role: userRole,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    if (error instanceof SubscriptionAccessDeniedError) {
      return NextResponse.json(
        { error: error.message, code: error.reason },
        { status: 402 }
      );
    }
    console.error("Failed to create project:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
