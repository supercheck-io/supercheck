import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, reports, jobs, ReportType } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";

export async function GET(
  request: Request, 
  context: { params: Promise<{ runId: string }> }
) {
  const params = await context.params;
  const runId = params.runId;

  if (!runId) {
    return NextResponse.json({ error: "Run ID is required" }, { status: 400 });
  }

  try {
    // Require authentication and project context
    const authCtx = await requireAuthContext();

    // Check view permission via context
    const canView = checkPermissionWithContext("job", "view", authCtx);
    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Fetch run scoped to current project
    const runResult = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        status: runs.status,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        durationMs: runs.durationMs,
        errorDetails: runs.errorDetails,
      })
      .from(runs)
      .innerJoin(jobs, eq(runs.jobId, jobs.id))
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.projectId, authCtx.project.id)
        )
      )
      .limit(1);

    if (runResult.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const run = runResult[0];

    // Fetch report details for this run
    const reportResult = await db.query.reports.findFirst({
      where: and(
        eq(reports.entityId, runId),
        eq(reports.entityType, 'job' as ReportType)
      ),
      columns: {
        s3Url: true
      }
    });

    // Return the relevant fields including the report URL
    return NextResponse.json({
      runId: run.id,
      jobId: run.jobId,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      errorDetails: run.errorDetails,
      // Use s3Url from reportResult if found, otherwise null
      reportUrl: reportResult?.s3Url || null,
    });

  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error(`Error fetching status for run ${runId}:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json(
      { error: `Failed to fetch run status: ${errorMessage}` },
      { status: 500 }
    );
  }
} 