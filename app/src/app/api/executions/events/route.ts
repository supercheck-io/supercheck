import { NextResponse } from "next/server";
import { getQueueEventHub, NormalizedQueueEvent } from "@/lib/queue-event-hub";
import { requireProjectContext } from "@/lib/project-context";
import { db } from "@/utils/db";
import { runs, jobs, tests, projects } from "@/db/schema";
import { eq } from "drizzle-orm";

const encoder = new TextEncoder();

/**
 * SSE endpoint for organization-wide execution events.
 * Used by the Parallel Executions dialog to track all running/queued executions
 * across all projects in the organization.
 * 
 * Uses QueueEventHub for real-time BullMQ events (waiting, active, completed, failed, stalled).
 */
export async function GET(request: Request) {
  try {
    const { organizationId } = await requireProjectContext();

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
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
          if (event.category !== "job" && event.category !== "test") {
            return;
          }

          try {
            const run = await db.query.runs.findFirst({
              where: eq(runs.id, event.queueJobId),
              columns: {
                id: true,
                projectId: true,
                jobId: true,
                metadata: true,
                startedAt: true,
              },
            });

            if (!run || !run.projectId) {
              return;
            }

            const project = await db.query.projects.findFirst({
              where: eq(projects.id, run.projectId!),
              columns: {
                id: true,
                name: true,
                organizationId: true,
              },
            });

            if (!project || project.organizationId !== organizationId) {
              return;
            }

            let jobName = "Unknown Execution";
            let jobType: "playwright" | "k6" = "playwright";
            let source: "job" | "playground" = "job";

            if (run.jobId) {
              const job = await db.query.jobs.findFirst({
                where: eq(jobs.id, run.jobId),
                columns: { name: true, jobType: true },
              });
              if (job) {
                jobName = job.name;
                jobType = job.jobType as "playwright" | "k6";
              }
            } else {
              const metadata = (run.metadata as Record<string, unknown>) || {};
              const testId = metadata.testId as string;
              const isPlayground = metadata.source === "playground";
              const testType = metadata.testType as string;

              source = isPlayground ? "playground" : "job";
              jobType = testType === "performance" ? "k6" : "playwright";
              jobName = isPlayground ? "Playground Execution" : "Ad-hoc Execution";

              if (testId) {
                try {
                  const test = await db.query.tests.findFirst({
                    where: eq(tests.id, testId),
                    columns: { title: true },
                  });
                  if (test?.title) {
                    jobName = test.title;
                  }
                } catch {
                  // Keep default name
                }
              }
            }

            const payload = {
              event: event.event,
              status: event.status,
              runId: event.queueJobId,
              jobId: run.jobId,
              jobName,
              jobType,
              source,
              projectName: project.name,
              projectId: project.id,
              startedAt: run.startedAt,
              timestamp: event.timestamp,
            };

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            );
          } catch (error) {
            console.error("Error processing execution event:", error);
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
            // Ignore close errors
          }
        };

        request.signal.addEventListener("abort", cleanup);
      },
    });

    return new NextResponse(stream, { headers });
  } catch (error) {
    console.error("Error setting up executions SSE stream:", error);

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
