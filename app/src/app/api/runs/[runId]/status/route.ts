import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, reports, ReportType } from "@/db/schema";
import { eq, and } from "drizzle-orm";

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
    const runResult = await db.query.runs.findFirst({
      where: eq(runs.id, runId),
    });

    if (!runResult) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
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
      runId: runResult.id,
      jobId: runResult.jobId,
      status: runResult.status,
      startedAt: runResult.startedAt,
      completedAt: runResult.completedAt,
      duration: runResult.duration,
      errorDetails: runResult.errorDetails,
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