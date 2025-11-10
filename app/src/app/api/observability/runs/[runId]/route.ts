import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, getUserOrgRole } from "@/lib/rbac/middleware";
import { isSuperAdmin } from "@/lib/admin";
import { getTraceByRunId, searchLogs } from "~/lib/observability";
import type {
  RunObservabilityResponse,
  TraceWithSpans,
  LogSearchResponse,
} from "~/types/observability";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  if (!runId) {
    return NextResponse.json(
      { error: "Run ID is required" },
      { status: 400 }
    );
  }

  try {
    const { userId } = await requireAuth();

    const runRecord = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        projectId: jobs.projectId,
        organizationId: jobs.organizationId,
        status: runs.status,
        startedAt: runs.startedAt,
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .where(eq(runs.id, runId))
      .limit(1);

    if (!runRecord.length) {
      return NextResponse.json(
        { error: "Run not found" },
        { status: 404 }
      );
    }

    const record = runRecord[0];
    const userIsSuperAdmin = await isSuperAdmin();

    if (!userIsSuperAdmin && record.organizationId) {
      const role = await getUserOrgRole(userId, record.organizationId);
      if (!role) {
        return NextResponse.json(
          { error: "Access denied" },
          { status: 403 }
        );
      }
    }

    const searchParams = req.nextUrl.searchParams;
    const endParam = searchParams.get("end");
    const startParam = searchParams.get("start");

    const end = endParam ? new Date(endParam) : new Date();
    const start = startParam
      ? new Date(startParam)
      : new Date(end.getTime() - 6 * 60 * 60 * 1000);

    const timeRange = {
      start: start.toISOString(),
      end: end.toISOString(),
    };

    let trace: TraceWithSpans | null = null;
    let logResult: LogSearchResponse | null = null;

    try {
      trace = await getTraceByRunId(runId);
    } catch (error) {
      console.error("Failed to load trace for run", runId, error);
    }

    try {
      logResult = await searchLogs({
        runId,
        projectId: record.projectId ?? undefined,
        organizationId: record.organizationId ?? undefined,
        timeRange,
        limit: 500,
        offset: 0,
      });
    } catch (error) {
      console.error("Failed to load logs for run", runId, error);
    }

    const hasTrace = Boolean(trace?.spans?.length);
    const logCount = logResult?.total ?? 0;
    const status = hasTrace || logCount ? "ok" : "no_data";

    const response: RunObservabilityResponse = {
      trace,
      logs: logResult?.data ?? [],
      metadata: {
        runId,
        hasTrace,
        logCount,
        status,
        message:
          status === "no_data"
            ? "No observability data was captured for this run's time range."
            : undefined,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to load run observability:", error);
    return NextResponse.json(
      { error: "Failed to load run observability" },
      { status: 500 }
    );
  }
}
