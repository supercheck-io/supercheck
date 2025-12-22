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
import { eq, desc } from "drizzle-orm";
import { fetchFromS3 } from "@/lib/s3-proxy";
import { notFound } from "next/navigation";
import { hasPermission, requireAuth } from "@/lib/rbac/middleware";
import { requireProjectContext } from "@/lib/project-context";

type AccessContext = {
  organizationId: string | null;
  projectId: string | null;
};

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
  // Require authentication
  try {
    await requireAuth();
  } catch {
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
          status: runs.status,
          errorDetails: runs.errorDetails,
          projectId: runs.projectId,
          jobId: runs.jobId,
          metadata: runs.metadata,
        })
        .from(runs)
        .where(eq(runs.id, entityId))
        .limit(1);

      if (runRecord.length > 0) {
        const run = runRecord[0];
        
        // Check permissions for this run
        try {
          // Determine organizationId (need to fetch from project or job)
          let organizationId: string | null = null;
          
          if (run.projectId) {
             const project = await db.query.projects.findFirst({
               where: eq(projects.id, run.projectId),
               columns: { organizationId: true }
             });
             if (project) organizationId = project.organizationId;
          }
          
          if (organizationId && run.projectId) {
            const authorized = await hasPermission("run", "view", {
              organizationId,
              projectId: run.projectId,
            });
            
            if (!authorized) {
               return NextResponse.json(
                { error: "Insufficient permissions" },
                { status: 403 }
              );
            }
          }
        } catch (e) {
          // Ignore permission check errors here, fall through to 404 if critical
          console.error("Error checking permissions for missing report run:", e);
        }

        // Check for cancellation
        const isCancellation = 
          (run.status as string) === "cancelled" || 
          (run.errorDetails?.toLowerCase().includes("cancellation") ?? false) ||
          (run.errorDetails?.toLowerCase().includes("cancelled") ?? false);

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
        const projectContext = await requireProjectContext();
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

    const authorized = await hasPermission(permissionResource, "view", {
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
        // Check if this is a cancellation by looking up the run's errorDetails
        let isCancellation = false;
        let errorDetails: string | null = null;
        
        if (reportResult.entityType === "job") {
          const runRecord = await db
            .select({ errorDetails: runs.errorDetails })
            .from(runs)
            .where(eq(runs.id, entityId))
            .limit(1);
          
          if (runRecord.length > 0) {
            errorDetails = runRecord[0].errorDetails;
            isCancellation = errorDetails?.toLowerCase().includes("cancellation") ||
                            errorDetails?.toLowerCase().includes("cancelled") || false;
          }
        } else if (reportResult.entityType === "test") {
          // For playground tests, check the report_metadata table for cancellation
          // The status will be 'error' and we can check if it was a cancellation
          // by looking at the status - 'error' status with no report typically means cancellation
          isCancellation = reportResult.status === "error";
          if (isCancellation) {
            errorDetails = "Cancellation requested by user";
          }
        } else if (reportResult.entityType === "k6_test" || reportResult.entityType === "k6_job") {
          const k6Record = await db
            .select({ errorDetails: k6PerformanceRuns.errorDetails })
            .from(k6PerformanceRuns)
            .where(eq(k6PerformanceRuns.runId, entityId))
            .limit(1);
          
          if (k6Record.length > 0) {
            errorDetails = k6Record[0].errorDetails;
            isCancellation = errorDetails?.toLowerCase().includes("cancellation") ||
                            errorDetails?.toLowerCase().includes("cancelled") || false;
          }
        }
        
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
        
        // For non-cancelled failed executions, check for timeout
        if (reportResult.entityType === "test" || reportResult.entityType === "k6_test") {
          return NextResponse.json(
            {
              error: "Test execution timeout",
              message: "Test execution timed out after 5 minutes",
              details: "Execution timed out after 5 minutes",
              timeoutInfo: {
                isTimeout: true,
                timeoutType: "test",
                timeoutDurationMs: 300000, // 5 minutes
                timeoutDurationMinutes: 5,
              },
              entityType: reportResult.entityType,
              status: reportResult.status,
            },
            { status: 408 }
          ); // 408 Request Timeout
        } else if (reportResult.entityType === "job" || reportResult.entityType === "k6_job") {
          return NextResponse.json(
            {
              error: "Job execution timeout",
              message: "Job execution timed out after 60 minutes",
              details: "Execution timed out after 60 minutes",
              timeoutInfo: {
                isTimeout: true,
                timeoutType: "job",
                timeoutDurationMs: 3600000, // 60 minutes (1 hour)
                timeoutDurationMinutes: 60,
              },
              entityType: reportResult.entityType,
              status: reportResult.status,
            },
            { status: 408 }
          ); // 408 Request Timeout
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
    const targetFile = reportFile || "index.html";

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
      // Use the shared S3 proxy utility
      const s3Response = await fetchFromS3(bucket, s3Key);

      // Convert Response to NextResponse
      const headers: Record<string, string> = {};
      s3Response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Override cache control for test results
      headers["Cache-Control"] = "public, max-age=300";

      // Only include Content-Disposition for downloads if not forcing iframe display
      const contentType = headers["Content-Type"] || "application/octet-stream";
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
