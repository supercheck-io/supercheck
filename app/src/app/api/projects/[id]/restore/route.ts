import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { projects } from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { requireUserAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { forbiddenOrNotFound, hasPermissionForUser, isImpersonatedSession } from "@/lib/rbac/middleware";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { ProjectDeletionError, restoreProject } from "@/lib/deletion/project";
import { checkProjectLimit } from "@/lib/middleware/plan-enforcement";
import { insertWithinPlanLimit } from "@/lib/middleware/plan-limit-lock";

/**
 * POST /api/projects/[id]/restore
 * Undo a project soft delete within the 7 day window (org owners and admins).
 * 409 RESTORE_WINDOW_ENDED once the window is over, 404 when the project is not deleted.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId, isCliAuth } = await requireUserAuthContext(id);
    if (isCliAuth) return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });
    const originError = requireSameOriginRequest(request, { allowMissing: isCliAuth });
    if (originError) return originError;
    if (await isImpersonatedSession()) return NextResponse.json({ error: "Stop impersonating before restoring a project" }, { status: 403 });
    if (!isUuid(id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const [project] = await db.select({ organizationId: projects.organizationId, status: projects.status }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!project || project.status !== "deleted") return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!(await hasPermissionForUser(userId, "project", "delete", { organizationId: project.organizationId }))) {
      return await forbiddenOrNotFound(userId, project.organizationId, "Insufficient permissions to restore project", "Project not found");
    }
    // A restored project counts against the plan again, so it goes through the same serialized limit check as creating one.
    const restored = await insertWithinPlanLimit({
      organizationId: project.organizationId,
      resource: "projects",
      check: checkProjectLimit,
      countRows: async (tx) => {
        const [row] = await tx.select({ count: sql<number>`count(*)` }).from(projects)
          .where(and(eq(projects.organizationId, project.organizationId), ne(projects.status, "deleted")));
        return Number(row?.count || 0);
      },
      insert: () => restoreProject({ projectId: id, actorUserId: userId }),
    });
    if (!restored.ok && restored.busy) return NextResponse.json({ error: "Too many concurrent requests. Please retry shortly." }, { status: 503, headers: { "Retry-After": "2" } });
    if (!restored.ok) return NextResponse.json({ error: restored.check.error, code: "PLAN_LIMIT" }, { status: 403 });
    return NextResponse.json({ success: true, message: "Project restored" });
  } catch (error) {
    if (error instanceof ProjectDeletionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (isAuthError(error)) return NextResponse.json({ error: error instanceof Error ? error.message : "Authentication required" }, { status: authErrorStatus(error) });
    console.error("Failed to restore project:", error);
    return NextResponse.json({ error: "Failed to restore project" }, { status: 500 });
  }
}
