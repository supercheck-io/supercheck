import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  jobs,
  k6PerformanceRuns,
  monitors,
  monitorResults,
  reports,
  runs,
  tests,
  projects,
} from "@/db/schema";
import { eq, desc, or, sql } from "drizzle-orm";
import { fetchFromS3 } from "@/lib/s3-proxy";
import { notFound } from "next/navigation";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireAuthContext, requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import {
  buildTimeoutResponse,
  isCancellationError,
  resolveExecutionErrorDetails,
} from "@/lib/report-results-utils";

const DEFAULT_REPORT_ASSET_MAX_RETRIES = 2;
const DEFAULT_REPORT_ASSET_RETRY_DELAY_MS = 250;

type AccessContext = {
  organizationId: string | null;
  projectId: string | null;
};

function getReportAssetRetryConfig() {
  const maxRetries = Number.parseInt(
    process.env.REPORT_ASSET_MAX_RETRIES ??
      `${DEFAULT_REPORT_ASSET_MAX_RETRIES}`,
    10
  );
  const retryDelayMs = Number.parseInt(
    process.env.REPORT_ASSET_RETRY_DELAY_MS ??
      `${DEFAULT_REPORT_ASSET_RETRY_DELAY_MS}`,
    10
  );

  return {
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 0,
    retryDelayMs:
      Number.isFinite(retryDelayMs) && retryDelayMs >= 0 ? retryDelayMs : 0,
  };
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function isObjectNotFoundResponse(response: Response): Promise<boolean> {
  if (response.status !== 404) {
    return false;
  }

  const contentType =
    response.headers.get("content-type") || response.headers.get("Content-Type");
  if (!contentType?.toLowerCase().includes("json")) {
    return false;
  }

  try {
    const body = (await response.clone().text()).toLowerCase();
    return body.includes("object not found");
  } catch {
    return false;
  }
}

function toTraceDataFallbackKey(s3Key: string): string | null {
  if (!s3Key.includes("/trace/data/")) {
    return null;
  }

  return s3Key.replace("/trace/data/", "/data/");
}

async function fetchReportAssetWithRecovery(
  bucket: string,
  s3Key: string
): Promise<Response> {
  const { maxRetries, retryDelayMs } = getReportAssetRetryConfig();
  let retries = 0;
  let currentKey = s3Key;
  let fallbackApplied = false;

  while (true) {
    const response = await fetchFromS3(bucket, currentKey);

    if (response.ok) {
      return response;
    }

    const isObjectNotFound = await isObjectNotFoundResponse(response);

    if (isObjectNotFound && !fallbackApplied) {
      const fallbackKey = toTraceDataFallbackKey(currentKey);
      if (fallbackKey && fallbackKey !== currentKey) {
        // Switch to the migrated path and reset retries so the full retry
        // budget applies to the fallback key (transient S3 consistency issues
        // can affect the new path just as they can the original).
        fallbackApplied = true;
        currentKey = fallbackKey;
        retries = 0;
        continue;
      }
    }

    if (isObjectNotFound && retries < maxRetries) {
      retries += 1;
      await sleep(retryDelayMs);
      continue;
    }

    return response;
  }
}

function getPermissionResource(entityType: string): "test" | "monitor" | "run" | null {
  if (entityType === "test") return "test";
  if (entityType === "monitor") return "monitor";
  if (entityType === "job" || entityType === "k6_test" || entityType === "k6_job") return "run";
  return null;
}

async function resolveAccessContext(
  entityType: string,
  entityId: string
): Promise<AccessContext | null> {
  try {
    if (entityType === "test") {
      const result = await db
        .select({
          organizationId: tests.organizationId,
          projectId: tests.projectId,
        })
        .from(tests)
        .where(eq(tests.id, entityId))
        .limit(1);

      if (!result.length) return null;
      return {
        organizationId: result[0].organizationId,
        projectId: result[0].projectId,
      };
    }

    if (entityType === "job") {
      const result = await db
        .select({
          organizationId: jobs.organizationId,
          projectId: runs.projectId,
        })
        .from(runs)
        .leftJoin(jobs, eq(jobs.id, runs.jobId))
        .where(eq(runs.id, entityId))
        .limit(1);

      if (!result.length) return null;
      return {
        organizationId: result[0].organizationId,
        projectId: result[0].projectId,
      };
    }

    if (entityType === "k6_test" || entityType === "k6_job") {
      const result = await db
        .select({
          organizationId: k6PerformanceRuns.organizationId,
          projectId: k6PerformanceRuns.projectId,
        })
        .from(k6PerformanceRuns)
        .where(eq(k6PerformanceRuns.runId, entityId))
        .limit(1);

      if (!result.length) return null;
      return {
        organizationId: result[0].organizationId,
        projectId: result[0].projectId,
      };
    }

    if (entityType === "monitor") {
      const result = await db
        .select({
          organizationId: monitors.organizationId,
          projectId: monitors.projectId,
        })
        .from(monitorResults)
        .leftJoin(monitors, eq(monitors.id, monitorResults.monitorId))
        .where(eq(monitorResults.testExecutionId, entityId))
        .limit(1);

      if (result.length) {
        return {
          organizationId: result[0].organizationId,
          projectId: result[0].projectId,
        };
      }

      const monitorRecord = await db
        .select({
          organizationId: monitors.organizationId,
          projectId: monitors.projectId,
        })
        .from(monitors)
        .where(eq(monitors.id, entityId))
        .limit(1);

      if (!monitorRecord.length) return null;
      return {
        organizationId: monitorRecord[0].organizationId,
        projectId: monitorRecord[0].projectId,
      };
    }

    return null;
  } catch (error) {
    console.error("[TEST-RESULTS] Error resolving access context:", error);
    return null;
  }
}

export async function GET(request: Request) {
  // Require authentication (supports both Bearer tokens and session cookies)
  let userId: string;
  try {
    const authContext = await requireUserAuthContext();
    userId = authContext.userId;
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  // Extract path parameters from the URL
  const url = new URL(request.url);
  // Remove the initial part of the path to get the dynamic part
  const fullPath = url.pathname;
  const basePath = "/api/test-results/";
  const path = fullPath
    .slice(basePath.length)
    .split("/")
    .filter((segment) => segment.length > 0);

  // Extract URL parameters including our special forceIframe parameter
  const forceIframe = url.searchParams.get("forceIframe") === "true";

  if (path.length < 1) {
    return notFound();
  }

  // Handle both old-style URLs (/jobs/[uuid]/...) and new-style URLs (/[uuid]/...)
  let entityId: string;
  let reportFile: string;

  // Check if the first segment is 'jobs' or 'tests' (old URL format)
  if (path[0] === "jobs" || path[0] === "tests") {
    // Old-style URL: /[entityType]/[uuid]/[...reportPath]
    if (path.length < 2) {
      return notFound();
    }

    entityId = path[1]; // Second segment is the entity ID
    reportFile = path.length > 2 ? path.slice(2).join("/") : "";
  } else {
    // New-style URL: /[uuid]/[...reportPath]
    entityId = path[0]; // First segment is the entity ID
    reportFile = path.length > 1 ? path.slice(1).join("/") : "";
  }

  try {
    // Query the reports table to get the s3Url for this entity
    const reportRows = await db
      .select({
        s3Url: reports.s3Url,
        reportPath: reports.reportPath,
        entityType: reports.entityType,
        status: reports.status,
        updatedAt: reports.updatedAt,
      })
      .from(reports)
      .where(eq(reports.entityId, entityId))
      .orderBy(desc(reports.updatedAt));

    if (!reportRows.length) {
      // If no report found, check if it's a run that was cancelled or failed
      // This handles cases where execution stopped before report generation
      const runRecord = await db
        .select({
          id: runs.id,
          status: runs.status,
          errorDetails: runs.errorDetails,
          projectId: runs.projectId,
          jobId: runs.jobId,
          metadata: runs.metadata,
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
        const run = runRecord[0];

        // Check permissions for this run
        let organizationId: string | null = null;
        try {
          if (run.projectId) {
            const project = await db.query.projects.findFirst({
              where: eq(projects.id, run.projectId),
              columns: { organizationId: true },
            });
            if (project) {
              organizationId = project.organizationId;
            }
          }
        } catch (e) {
          console.error("Error resolving project context for missing report run:", e);
          return notFound();
        }

        if (!organizationId || !run.projectId) {
          return notFound();
        }

        try {
          const authorized = await hasPermissionForUser(userId, "run", "view", {
            organizationId,
            projectId: run.projectId,
          });

          if (!authorized) {
            return NextResponse.json(
              { error: "Insufficient permissions" },
              { status: 403 }
            );
          }
        } catch (e) {
          console.error("Error checking permissions for missing report run:", e);
          return notFound();
        }

        // Check for cancellation
        const isCancellation =
          (run.status as string) === "cancelled" ||
          isCancellationError(run.errorDetails);

        if (isCancellation) {
          return NextResponse.json(
            {
              error: "Execution cancelled",
              message: "This execution was cancelled by a user",
              details: run.errorDetails || "Cancellation requested by user",
              cancellationInfo: {
                isCancelled: true,
              },
              entityType: run.jobId ? "job" : "test",
              status: "cancelled",
            },
            { status: 499 }
          );
        }
        
        // Check for running state
        const status = run.status as string;
        if (status === "running" || status === "queued" || status === "pending") {
           return NextResponse.json(
            {
              error: "Report not ready",
              details: "The test is still running. Please wait for it to complete.",
            },
            { status: 202 }
          );
        }

        const timeoutResponse = buildTimeoutResponse(run.jobId ? "job" : "test", run.errorDetails);
        if (timeoutResponse) {
          return timeoutResponse;
        }

        if (status === "failed" || status === "error") {
          return NextResponse.json(
            {
              error: "Execution failed",
              message: "The execution failed without generating a report",
              details: run.errorDetails || "The execution completed but no report was generated",
              entityType: run.jobId ? "job" : "test",
              status,
            },
            { status: 500 }
          );
        }
      }

      return notFound();
    }

    const reportResult =
      reportRows.find((row) => row.entityType === "k6_test" || row.entityType === "k6_job") ??
      reportRows[0];

    const permissionResource = getPermissionResource(reportResult.entityType);
    let accessContext = await resolveAccessContext(
      reportResult.entityType,
      entityId
    );

    // Fallback for ad-hoc playground tests that don’t have a persisted test record
    if (
      (!accessContext?.organizationId || !accessContext.projectId) &&
      permissionResource === "test"
    ) {
      try {
        const projectContext = await requireAuthContext();
        accessContext = {
          organizationId: projectContext.organizationId,
          projectId: projectContext.project.id,
        };
      } catch (error) {
        console.warn("[TEST-RESULTS] Failed to resolve project context:", error);
      }
    }

    if (!permissionResource || !accessContext?.organizationId || !accessContext.projectId) {
      return notFound();
    }

    const authorized = await hasPermissionForUser(userId, permissionResource, "view", {
      organizationId: accessContext.organizationId,
      projectId: accessContext.projectId,
    });

    if (!authorized) {
      return NextResponse.json(
        { error: "Insufficient permissions to view this report" },
        { status: 403 }
      );
    }

    if (!reportResult.s3Url) {
      if (reportResult.status === "running") {
        return NextResponse.json(
          {
            error: "Report not ready",
            details:
              "The test is still running. Please wait for it to complete.",
          },
          { status: 202 }
        );
      }

      // Check for error status (includes cancellation) or failed status
      if (reportResult.status === "error" || reportResult.status === "failed") {
        const failureContext = await resolveExecutionErrorDetails(
          reportResult.entityType,
          entityId
        );
        const errorDetails = failureContext.errorDetails;
        const isCancellation =
          failureContext.status === "cancelled" ||
          isCancellationError(errorDetails);
        
        // Return cancellation-specific response
        if (isCancellation) {
          return NextResponse.json(
            {
              error: "Execution cancelled",
              message: "This execution was cancelled by a user",
              details: errorDetails || "Cancellation requested by user",
              cancellationInfo: {
                isCancelled: true,
              },
              entityType: reportResult.entityType,
              status: reportResult.status,
            },
            { status: 499 } // 499 Client Closed Request (commonly used for cancellations)
          );
        }

        const timeoutResponse = buildTimeoutResponse(
          reportResult.entityType,
          errorDetails
        );
        if (timeoutResponse) {
          return timeoutResponse;
        }

        // Return general failed execution error for other entity types
        return NextResponse.json(
          {
            error: "Execution failed",
            message: "The execution failed without generating a report",
            details: errorDetails || "The execution completed but no report was generated",
            entityType: reportResult.entityType,
            status: reportResult.status,
          },
          { status: 500 }
        );
      }

      return notFound();
    }

    // Parse S3 URL to extract useful parts
    const s3Url = new URL(reportResult.s3Url);
    const pathParts = s3Url.pathname
      .split("/")
      .filter((part) => part.length > 0);
    const bucket = pathParts[0];

    // Determine the file path based on what's being requested
    // Sanitize path segments to prevent directory traversal attempts
    const targetFile = (reportFile || "index.html")
      .split("/")
      .filter((seg) => seg !== ".." && seg !== ".")
      .join("/");

    // Prefer the stored reportPath when available
    const storedReportPath = reportResult.reportPath
      ? reportResult.reportPath.replace(/^\/+/, "").replace(/\/+$/, "")
      : null;

    let s3Key: string;

    if (storedReportPath) {
      const normalizedBase = storedReportPath.replace(/\/+$/, "");
      s3Key = `${normalizedBase}/${targetFile}`;
    } else {
      const entityIdIndex = pathParts.indexOf(entityId);
      if (entityIdIndex !== -1) {
        const prefix = pathParts
          .slice(entityIdIndex, pathParts.length - 1)
          .join("/");
        s3Key = `${prefix}/${targetFile}`;
      } else {
        s3Key = `${entityId}/report/${targetFile}`;
      }
    }

    // Normalise potential duplicate segments
    s3Key = s3Key
      .replace(/\/+/g, "/")
      .replace(/\/report\/report\//g, "/report/")
      .replace(/\/*$/, "");

    try {
      // Retry transient S3 misses and apply trace/data fallback when needed.
      const s3Response = await fetchReportAssetWithRecovery(bucket, s3Key);

      // Convert Response to NextResponse
      const headers: Record<string, string> = {};
      s3Response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Cache successful report assets briefly, but never cache error responses.
      // Caching 404/500 here can make freshly-uploaded reports appear missing.
      headers["Cache-Control"] = s3Response.ok
        ? "public, max-age=300"
        : "no-store, no-cache, must-revalidate";

      // Only include Content-Disposition for downloads if not forcing iframe display
      const contentType =
        headers["content-type"] ||
        headers["Content-Type"] ||
        "application/octet-stream";
      if (
        !forceIframe &&
        contentType.includes("application/") &&
        !contentType.includes("html")
      ) {
        headers["Content-Disposition"] = `inline; filename="${targetFile
          .split("/")
          .pop()}"`;
      }

      const buffer = await s3Response.arrayBuffer();

      return new NextResponse(buffer, {
        status: s3Response.status,
        headers,
      });
    } catch (error) {
      console.error("[TEST-RESULTS] Error fetching from S3:", error);
      return notFound();
    }
  } catch (error) {
    console.error(`[TEST-RESULTS] Error processing request:`, error);
    return notFound();
  }
}
