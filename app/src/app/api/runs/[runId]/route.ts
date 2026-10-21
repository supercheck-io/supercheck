import { deleteRunWithContext } from "@/lib/resource-deletion/run";
import { runHistoryFields, runReportType } from "@/lib/run-history";
import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, reports, jobs, jobTests, projects, tests } from "@/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";

// Get run handler - scoped to current project
export async function GET(
  request: Request,
  routeContext: { params: Promise<{ runId: string }> }
) {
  const params = await routeContext.params;
  try {
    const authCtx = await requireAuthContext();
    const runId = params.runId;

    if (!runId) {
      return NextResponse.json({ error: "Missing run ID" }, { status: 400 });
    }

    // Check view permission via context
    const canView = checkPermissionWithContext("job", "view", authCtx);
    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Find the run scoped to current project
    const result = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        ...runHistoryFields,
        status: runs.status,
        durationMs: runs.durationMs,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        logs: runs.logs,
        errorDetails: runs.errorDetails,
        trigger: runs.trigger,
        projectId: runs.projectId,
        organizationId: projects.organizationId,
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .innerJoin(projects, sql`${projects.id} = coalesce(${runs.projectId}, ${jobs.projectId})`)
      .leftJoin(tests, and(sql`${tests.id}::text = ${runs.metadata}->>'testId'`, eq(tests.projectId, projects.id)))
      .leftJoin(
        reports,
        and(
          sql`${reports.entityId} = ${runs.id}::text`,
          eq(reports.entityType, runReportType)
        )
      )
      .where(
        and(
          eq(runs.id, runId),
          eq(projects.id, authCtx.project.id),
          eq(projects.organizationId, authCtx.organizationId)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const run = result[0];

    // Get test count for this job
    let testCount = run.jobId ? 0 : 1;
    if (run.jobId) {
      const testCountResult = await db
        .select({ count: count() })
        .from(jobTests)
        .where(eq(jobTests.jobId, run.jobId));

      testCount = testCountResult[0]?.count || 0;
    }

    const response = {
      ...run,
      testCount,
    };

    return NextResponse.json(response);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error fetching run:", error);
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
  }
}

// Delete run handler
export async function DELETE(
  _request: Request,
  routeContext: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await routeContext.params;
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("run", "delete", context)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const result = await deleteRunWithContext(runId, context);
    const status = result.success ? 200 : result.error?.includes("not found") ? 404 : result.error?.includes("active") ? 409 : 500;
    return NextResponse.json(result, { status });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("Error deleting run:", error);
    return NextResponse.json({ success: false, error: "Failed to delete run" }, { status: 500 });
  }
}
