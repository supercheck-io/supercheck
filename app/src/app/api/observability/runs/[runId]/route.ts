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

function isAuthError(error: unknown) {
  return (
    error instanceof Error &&
    /unauthenticated|unauthorized|api key/i.test(error.message)
  );
}

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
    let authBlocked = false;

    try {
      trace = await getTraceByRunId(runId);
    } catch (error) {
      if (isAuthError(error)) {
        authBlocked = true;
        console.warn("Observability trace auth error", error);
      } else {
        throw error;
      }
    }

    if (!authBlocked) {
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
        if (isAuthError(error)) {
          authBlocked = true;
          console.warn("Observability log auth error", error);
        } else {
          throw error;
        }
      }
    }

    const response: RunObservabilityResponse = {
      trace: trace && !authBlocked ? trace : null,
      logs: authBlocked ? [] : logResult?.data ?? [],
      metadata: {
        runId,
        hasTrace: Boolean(trace?.spans?.length),
        logCount: logResult?.total ?? 0,
        status: authBlocked ? "auth_required" : "ok",
        message: authBlocked
          ? "SigNoz rejected the request. Add SIGNOZ_API_KEY or set SIGNOZ_DISABLE_AUTH=true to enable observability data."
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
