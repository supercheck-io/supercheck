
import { NextResponse } from "next/server";
import { getQueueEventHub, NormalizedQueueEvent } from "@/lib/queue-event-hub";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { db } from "@/utils/db";
import { runs, jobs, tests } from "@/db/schema";
import { eq } from "drizzle-orm";

const encoder = new TextEncoder();

export async function GET(request: Request) {
  try {
    // Require authentication and get project context
    const { project, organizationId } = await requireProjectContext();

    // Check permission to view jobs
    const canView = await hasPermission("job", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    };

    const stream = new ReadableStream({
      async start(controller) {
        const hub = getQueueEventHub();
        await hub.ready();

        // Cache for run/job metadata to avoid repeated queries
        // Key: runId, Value: { projectId, jobId, jobName, jobType, metadata }
        const runCache = new Map<string, {
          projectId: string | null;
          jobId: string | null;
          jobName: string;
          jobType: string;
          metadata: Record<string, unknown> | null;
          organizationId: string | null;
        } | null>();

        const sendEvent = async (event: NormalizedQueueEvent) => {
          // Only send job and test events (Playwright jobs are in 'test' category)
          if (event.category !== "job" && event.category !== "test") {
            return;
          }

          try {
            const runId = event.queueJobId;
            
            // OPTIMIZED: Prevent unbounded cache growth
            // Clear cache if it gets too large (simple LRU-like strategy)
            if (runCache.size > 1000) {
              runCache.clear();
            }

            // Check cache first
            let runData = runCache.get(runId);
            
            if (runData === undefined) {
              // Not in cache - fetch with a single optimized query
              // This replaces 5 separate queries with 1 JOIN query
              const result = await db
                .select({
                  runId: runs.id,
                  runProjectId: runs.projectId,
                  runJobId: runs.jobId,
                  runMetadata: runs.metadata,
                  jobName: jobs.name,
                  jobType: jobs.jobType,
                  jobProjectId: jobs.projectId,
                  jobOrgId: jobs.organizationId,
                })
                .from(runs)
                .leftJoin(jobs, eq(runs.jobId, jobs.id))
                .where(eq(runs.id, runId))
                .limit(1);

              if (result.length === 0) {
                // Run not found - cache null to avoid repeated lookups
                runCache.set(runId, null);
                return;
              }

              const row = result[0];
              const metadata = (row.runMetadata as Record<string, unknown>) || {};
              
              // Determine job name
              let jobName = "Unknown Execution";
              if (row.runJobId && row.jobName) {
                jobName = row.jobName;
              } else if (metadata.source === 'playground') {
                jobName = 'Playground Execution';
              } else if (metadata.testId) {
                // For playground runs with testId, we could fetch test name
                // but keeping it simple - use a generic name to avoid extra query
                jobName = 'Test Execution';
              }

              // Determine job type
              let jobType = "playwright";
              if (row.runJobId && row.jobType) {
                jobType = row.jobType;
              } else if (metadata.testType === 'performance') {
                jobType = 'k6';
              }

              runData = {
                projectId: row.runProjectId,
                jobId: row.runJobId,
                jobName,
                jobType,
                metadata,
                organizationId: row.jobOrgId,
              };
              
              runCache.set(runId, runData);
            }

            // If cached as null (not found), skip
            if (runData === null) {
              return;
            }

            // Security: Verify run belongs to user's project
            if (runData.projectId !== project.id) {
              return;
            }

            // For job runs, verify org membership
            if (runData.jobId && runData.organizationId !== organizationId) {
              return;
            }

            // Event is authorized, send it
            const payload = {
              queue: event.queue,
              event: event.event,
              status: event.status,
              runId: event.queueJobId,
              jobId: event.entityId ?? event.queueJobId,
              jobName: runData.jobName,
              jobType: runData.jobType,
              trigger: event.trigger,
              timestamp: event.timestamp,
              returnValue: event.returnValue,
              failedReason: event.failedReason,
              hasJobId: !!runData.jobId,
            };

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            );
          } catch (error) {
            console.error("Error filtering job event:", error);
            // Silently skip events that cause errors during authorization
          }
        };

        const unsubscribe = hub.subscribe(sendEvent);

        controller.enqueue(encoder.encode(": connected\n\n"));

        const keepAlive = setInterval(() => {
          controller.enqueue(encoder.encode(": ping\n\n"));
        }, 30000);

        const cleanup = () => {
          clearInterval(keepAlive);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // ignore errors closing stream
          }
        };

        request.signal.addEventListener("abort", cleanup);
      },
    });

    return new NextResponse(stream, { headers });
  } catch (error) {
    console.error("Error setting up job-status SSE stream:", error);

    // Handle authentication/authorization errors
    if (error instanceof Error) {
      if (error.message === "Authentication required") {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }

      if (error.message.includes("not found") || error.message.includes("No active project")) {
        return NextResponse.json(
          { error: "No active project found" },
          { status: 404 }
        );
      }
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
