import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, reports, jobs, ReportType } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";

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
    const { organizationId } = await requireProjectContext();

    // Fetch run with its associated job to verify organization access
    const runResult = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        status: runs.status,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        duration: runs.duration,
        errorDetails: runs.errorDetails,
        jobOrganizationId: jobs.organizationId,
      })
      .from(runs)
      .innerJoin(jobs, eq(runs.jobId, jobs.id))
      .where(eq(runs.id, runId))
      .limit(1);

    if (runResult.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const run = runResult[0];

    // Verify the run belongs to the user's organization
    if (run.jobOrganizationId !== organizationId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

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
      duration: run.duration,
      errorDetails: run.errorDetails,
      // Use s3Url from reportResult if found, otherwise null
      reportUrl: reportResult?.s3Url || null,
    });

  } catch (error) {
    console.error(`Error fetching status for run ${runId}:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json(
      { error: `Failed to fetch run status: ${errorMessage}` },
      { status: 500 }
    );
  }
} 