import { NextResponse } from "next/server";
import { getQueueEventHub, NormalizedQueueEvent } from "@/lib/queue-event-hub";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { db } from "@/utils/db";
import { runs, jobs } from "@/db/schema";
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

        const sendEvent = async (event: NormalizedQueueEvent) => {
          // Only send job and test events (Playwright jobs are in 'test' category)
          if (event.category !== "job" && event.category !== "test") {
            return;
          }

          // Security: Filter events to only include those from the user's project
          try {
            // First check the run to verify it belongs to this project
            const run = await db.query.runs.findFirst({
              where: eq(runs.id, event.queueJobId),
            });

            if (!run) {
              // Run not found, skip this event
              return;
            }

            // Verify the run belongs to the user's project
            if (run.projectId !== project.id) {
              // Run belongs to a different project, skip this event
              return;
            }

            // If this is a job run, also verify the job belongs to the project
            if (run.jobId) {
              const job = await db.query.jobs.findFirst({
                where: eq(jobs.id, run.jobId),
              });

              if (!job || job.projectId !== project.id || job.organizationId !== organizationId) {
                // Job doesn't exist or belongs to different project/org, skip this event
                return;
              }
            }

            // Event is authorized, send it
            const payload = {
              queue: event.queue,
              event: event.event,
              status: event.status,
              runId: event.queueJobId,
              jobId: event.entityId ?? event.queueJobId,
              trigger: event.trigger,
              timestamp: event.timestamp,
              returnValue: event.returnValue,
              failedReason: event.failedReason,
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
