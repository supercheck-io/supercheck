import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { reports } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { fetchFromS3 } from "@/lib/s3-proxy";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/rbac/middleware";

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
      return notFound();
    }

    const reportResult =
      reportRows.find((row) => row.entityType === "k6_performance") ??
      reportRows[0];

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

      // Check if this is likely a timeout error for failed executions
      if (reportResult.status === "failed") {
        // For failed test executions without reports, it's very likely a timeout
        // since script validation errors and other issues usually still generate some output
        if (reportResult.entityType === "test") {
          return NextResponse.json(
            {
              error: "Test execution timeout",
              message: "Test execution timed out after 2 minutes",
              details: "Execution timed out after 2 minutes",
              timeoutInfo: {
                isTimeout: true,
                timeoutType: "test",
                timeoutDurationMs: 120000, // 2 minutes
                timeoutDurationMinutes: 2,
              },
              entityType: reportResult.entityType,
              status: reportResult.status,
            },
            { status: 408 }
          ); // 408 Request Timeout
        } else if (reportResult.entityType === "job") {
          return NextResponse.json(
            {
              error: "Job execution timeout",
              message: "Job execution timed out after 15 minutes",
              details: "Execution timed out after 15 minutes",
              timeoutInfo: {
                isTimeout: true,
                timeoutType: "job",
                timeoutDurationMs: 900000, // 15 minutes
                timeoutDurationMinutes: 15,
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
            details: "The execution completed but no report was generated",
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
