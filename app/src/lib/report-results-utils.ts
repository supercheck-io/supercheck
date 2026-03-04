import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { k6PerformanceRuns, runs } from "@/db/schema";
import { desc, eq, or, sql } from "drizzle-orm";
import { detectTimeoutError } from "@/lib/timeout-utils";

export const isCancellationError = (
  details: string | null | undefined
): boolean => {
  const normalized = details?.toLowerCase() ?? "";
  return (
    normalized.includes("cancellation") ||
    normalized.includes("cancelled")
  );
};

export function buildTimeoutResponse(
  entityType: string,
  errorDetails: string | null
) {
  const timeoutInfo = detectTimeoutError(errorDetails);
  if (!timeoutInfo.isTimeout) {
    return null;
  }

  const getDefaultTimeoutMs = (type: string): number => {
    if (type === "test") {
      return Number(process.env.TEST_EXECUTION_TIMEOUT_MS ?? 300000);
    }
    if (type === "k6_test") {
      return Number(process.env.K6_TEST_EXECUTION_TIMEOUT_MS ?? 3600000);
    }
    if (type === "k6_job") {
      return Number(process.env.K6_JOB_EXECUTION_TIMEOUT_MS ?? 3600000);
    }
    return Number(process.env.JOB_EXECUTION_TIMEOUT_MS ?? 3600000);
  };

  const defaultType =
    entityType === "test"
      ? "test"
      : entityType === "job" ||
          entityType === "k6_test" ||
          entityType === "k6_job"
        ? "job"
        : "unknown";

  const timeoutType =
    timeoutInfo.timeoutType === "unknown"
      ? defaultType
      : timeoutInfo.timeoutType;
  const timeoutDurationMs =
    timeoutInfo.timeoutDurationMs > 0
      ? timeoutInfo.timeoutDurationMs
      : getDefaultTimeoutMs(entityType);
  const timeoutDurationMinutes = Math.max(
    1,
    Math.floor(timeoutDurationMs / 60000)
  );

  const label =
    timeoutType === "test"
      ? "Test"
      : timeoutType === "job"
        ? "Job"
        : "Execution";

  return NextResponse.json(
    {
      error: `${label} execution timeout`,
      message: `${label} execution timed out after ${timeoutDurationMinutes} minute${
        timeoutDurationMinutes !== 1 ? "s" : ""
      }`,
      details:
        errorDetails ||
        `Execution timed out after ${timeoutDurationMinutes} minutes`,
      timeoutInfo: {
        isTimeout: true,
        timeoutType,
        timeoutDurationMs,
        timeoutDurationMinutes,
      },
      entityType,
      status: "error",
    },
    { status: 408 }
  );
}

export async function resolveExecutionErrorDetails(
  entityType: string,
  entityId: string
): Promise<{ errorDetails: string | null; status: string | null }> {
  if (entityType === "job" || entityType === "test") {
    const runRecord = await db
      .select({
        errorDetails: runs.errorDetails,
        status: runs.status,
      })
      .from(runs)
      .where(
        or(
          eq(runs.id, entityId),
          sql`${runs.metadata}->>'testId' = ${entityId}`
        )
      )
      .orderBy(desc(runs.createdAt))
      .limit(1);

    if (runRecord.length > 0) {
      return {
        errorDetails: runRecord[0].errorDetails,
        status: runRecord[0].status as string,
      };
    }
  }

  if (entityType === "k6_test" || entityType === "k6_job") {
    const k6Record = await db
      .select({
        errorDetails: k6PerformanceRuns.errorDetails,
        status: k6PerformanceRuns.status,
      })
      .from(k6PerformanceRuns)
      .where(eq(k6PerformanceRuns.runId, entityId))
      .limit(1);

    if (k6Record.length > 0) {
      return {
        errorDetails: k6Record[0].errorDetails,
        status: k6Record[0].status as string,
      };
    }
  }

  return { errorDetails: null, status: null };
}
