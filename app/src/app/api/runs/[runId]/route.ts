import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, reports, jobs, jobTests } from "@/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import { requireAuth, getUserOrgRole } from "@/lib/rbac/middleware";
import { isSuperAdmin } from "@/lib/admin";
import { logAuditEvent } from "@/lib/audit-logger";
import { canManageRuns } from "@/lib/rbac/client-permissions";

// Get run handler - requires auth but no project restrictions
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const params = await context.params;
  try {
    const { userId } = await requireAuth();
    const runId = params.runId;

    if (!runId) {
      return NextResponse.json({ error: "Missing run ID" }, { status: 400 });
    }

    // First, find the run and its associated job/project without filtering by active project
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
      .where(eq(runs.id, runId))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const run = result[0];

    // Check if user has access to this run's organization
    const userIsSuperAdmin = await isSuperAdmin();

    if (!userIsSuperAdmin && run.organizationId) {
      const orgRole = await getUserOrgRole(userId, run.organizationId);

      if (!orgRole) {
        return NextResponse.json(
          { error: "Access denied: Not a member of this organization" },
          { status: 403 }
        );
      }
    }

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
    console.error("Error fetching run:", error);
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
  }
}

// Delete run handler
export async function DELETE(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const params = await context.params;
  let userId: string | undefined;
  let runId: string | undefined;

  try {
    const authResult = await requireAuth();
    userId = authResult.userId;
    runId = params.runId;
    console.log(`Attempting to delete run with ID: ${runId}`);

    if (!runId) {
      console.error("Missing run ID");
      return NextResponse.json(
        { success: false, error: "Missing run ID" },
        { status: 400 }
      );
    }

    // First get the run and its associated job/project (same pattern as GET method)
    const existingRunData = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        projectId: jobs.projectId,
        organizationId: jobs.organizationId,
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .where(eq(runs.id, runId))
      .limit(1);

    if (!existingRunData.length) {
      console.error(`Run with ID ${runId} not found`);
      return NextResponse.json(
        { success: false, error: "Run not found" },
        { status: 404 }
      );
    }

    const run = existingRunData[0];

    // Check if user has access to this run's organization (same access pattern as GET method)
    const userIsSuperAdmin = await isSuperAdmin();

    if (!userIsSuperAdmin && run.organizationId) {
      const orgRole = await getUserOrgRole(userId, run.organizationId);

      if (!orgRole) {
        return NextResponse.json(
          { error: "Access denied: Not a member of this organization" },
          { status: 403 }
        );
      }

      // Check if user has permission to manage runs
      if (!canManageRuns(orgRole)) {
        return NextResponse.json(
          { error: "Access denied: Insufficient permissions to delete runs" },
          { status: 403 }
        );
      }
    }

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
