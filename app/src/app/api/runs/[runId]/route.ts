import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, reports, jobs, jobTests } from "@/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { logAuditEvent } from "@/lib/audit-logger";

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
        jobName: jobs.name,
        status: runs.status,
        durationMs: runs.durationMs,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        logs: runs.logs,
        errorDetails: runs.errorDetails,
        reportUrl: reports.s3Url,
        trigger: runs.trigger,
        projectId: jobs.projectId,
        organizationId: jobs.organizationId,
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .leftJoin(
        reports,
        and(
          sql`${reports.entityId} = ${runs.id}::text`,
          eq(reports.entityType, "job")
        )
      )
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.projectId, authCtx.project.id)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const run = result[0];

    // Get test count for this job
    let testCount = 0;
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
  request: Request,
  routeContext: { params: Promise<{ runId: string }> }
) {
  const params = await routeContext.params;
  let userId: string | undefined;
  let runId: string | undefined;

  try {
    const authCtx = await requireAuthContext();
    userId = authCtx.userId;
    runId = params.runId;
    console.log(`Attempting to delete run with ID: ${runId}`);

    if (!runId) {
      console.error("Missing run ID");
      return NextResponse.json(
        { success: false, error: "Missing run ID" },
        { status: 400 }
      );
    }

    // Check delete permission via context
    const canDelete = checkPermissionWithContext("job", "delete", authCtx);
    if (!canDelete) {
      return NextResponse.json(
        { error: "Insufficient permissions to delete runs" },
        { status: 403 }
      );
    }

    // Find the run scoped to current project
    const existingRunData = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        projectId: runs.projectId,
        organizationId: jobs.organizationId,
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.projectId, authCtx.project.id)
        )
      )
      .limit(1);

    if (!existingRunData.length) {
      console.error(`Run with ID ${runId} not found`);
      return NextResponse.json(
        { success: false, error: "Run not found" },
        { status: 404 }
      );
    }

    const run = existingRunData[0];

    console.log(`Deleting reports for run: ${runId}`);
    // First delete any associated reports
    await db.delete(reports).where(eq(reports.entityId, runId));

    console.log(`Deleting run: ${runId}`);
    // Then delete the run itself
    await db.delete(runs).where(eq(runs.id, runId));

    // Log audit event for run deletion
    try {
      await logAuditEvent({
        userId,
        organizationId: run.organizationId || undefined,
        action: "run_delete",
        resource: "run",
        resourceId: runId,
        metadata: {
          jobId: run.jobId,
          projectId: run.projectId,
        },
        success: true,
      });
    } catch (auditError) {
      console.error("Failed to log audit event for run deletion:", auditError);
      // Continue with success response as audit failure shouldn't break the operation
    }

    console.log(`Successfully deleted run: ${runId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error deleting run:", error);

    // Log audit event for run deletion failure
    if (userId && runId) {
      try {
        await logAuditEvent({
          userId,
          organizationId: undefined, // May not be available in error scenarios
          action: "run_delete",
          resource: "run",
          resourceId: runId,
          metadata: {
            errorType: "internal_error",
            errorMessage:
              error instanceof Error ? error.message : "Unknown error",
          },
          success: false,
        });
      } catch (auditError) {
        console.error(
          "Failed to log audit event for run deletion failure:",
          auditError
        );
      }
    }

    return NextResponse.json(
      { success: false, error: "Failed to delete run" },
      { status: 500 }
    );
  }
}
