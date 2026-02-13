import { NextRequest, NextResponse } from "next/server";
import { hasPermissionForUser, getUserRole } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { getUserProjects } from "@/lib/session";
import { getCurrentProjectContext } from "@/lib/project-context";
import { db } from "@/utils/db";
import { projects, projectMembers } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { checkProjectLimit } from "@/lib/middleware/plan-enforcement";
import { eq, sql } from "drizzle-orm";
import { subscriptionService } from "@/lib/services/subscription-service";

/**
 * GET /api/projects
 * List all projects for the current user in the active organization
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId: authOrgId } = await requireUserAuthContext();

    // Get organization ID from query params or use auth context organization
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");

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

    // Get current project context
    const currentProject = await getCurrentProjectContext();

    return NextResponse.json({
      success: true,
      data: userProjects,
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
    const { userId, organizationId: authOrgId } = await requireUserAuthContext();

    const body = await request.json();
    const { name, slug, description, organizationId } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Project name is required" },
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

    // Check project limit based on subscription plan
    // OPTIMIZED: Use SQL count(*) instead of fetching all rows and using .length
    const projectCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(projects)
      .where(eq(projects.organizationId, targetOrgId));

    const limitCheck = await checkProjectLimit(
      targetOrgId,
      Number(projectCountResult[0]?.count || 0)
    );
    if (!limitCheck.allowed) {
      console.warn(
        `Project limit reached for organization ${targetOrgId}: ${limitCheck.error}`
      );
      return NextResponse.json({ error: limitCheck.error }, { status: 403 });
    }

    // Create project
    const [newProject] = await db
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
    console.error("Failed to create project:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
