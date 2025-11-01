import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import {
  k6PerformanceRuns,
  runs as runsTable,
  tests,
} from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";

type Params = { runId: string };

export async function GET(
  _request: Request,
  context: { params: Promise<Params> }
) {
  const params = await context.params;
  const runId = params.runId;

  if (!runId) {
    return NextResponse.json({ error: "Missing run ID" }, { status: 400 });
  }

  try {
    const { project, organizationId } = await requireProjectContext();

    // Ensure user can view tests within project
    const canViewTests = await hasPermission("test", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canViewTests) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const result = await db
      .select({
        id: k6PerformanceRuns.id,
        runId: k6PerformanceRuns.runId,
        testId: k6PerformanceRuns.testId,
        status: k6PerformanceRuns.status,
        startedAt: k6PerformanceRuns.startedAt,
        completedAt: k6PerformanceRuns.completedAt,
        durationMs: k6PerformanceRuns.durationMs,
        location: k6PerformanceRuns.location,
        thresholdsPassed: k6PerformanceRuns.thresholdsPassed,
        totalRequests: k6PerformanceRuns.totalRequests,
        failedRequests: k6PerformanceRuns.failedRequests,
        requestRate: k6PerformanceRuns.requestRate,
        avgResponseTimeMs: k6PerformanceRuns.avgResponseTimeMs,
        p95ResponseTimeMs: k6PerformanceRuns.p95ResponseTimeMs,
        p99ResponseTimeMs: k6PerformanceRuns.p99ResponseTimeMs,
        reportS3Url: k6PerformanceRuns.reportS3Url,
        summaryS3Url: k6PerformanceRuns.summaryS3Url,
        consoleS3Url: k6PerformanceRuns.consoleS3Url,
        errorDetails: k6PerformanceRuns.errorDetails,
        consoleOutput: k6PerformanceRuns.consoleOutput,
        summaryJson: k6PerformanceRuns.summaryJson,
        runStatus: runsTable.status,
        runReportUrl: runsTable.reportS3Url,
        runLogsUrl: runsTable.logsS3Url,
        testTitle: tests.title,
      })
      .from(k6PerformanceRuns)
      .leftJoin(runsTable, eq(runsTable.id, k6PerformanceRuns.runId))
      .leftJoin(tests, eq(tests.id, k6PerformanceRuns.testId))
      .where(
        and(
          eq(k6PerformanceRuns.runId, runId),
          eq(k6PerformanceRuns.projectId, project.id),
          eq(k6PerformanceRuns.organizationId, organizationId)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("Error fetching k6 run:", error);
    return NextResponse.json(
      { error: "Failed to fetch run details" },
      { status: 500 }
    );
  }
}
