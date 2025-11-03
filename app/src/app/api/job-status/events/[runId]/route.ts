import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { runs } from "@/db/schema";
import { getQueueEventHub, NormalizedQueueEvent } from "@/lib/queue-event-hub";

const encoder = new TextEncoder();

const serialize = (payload: Record<string, unknown>) =>
  `data: ${JSON.stringify(payload)}\n\n`;

async function fetchRunDetails(runId: string) {
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, runId),
  });

  if (!run) {
    return null;
  }

  return {
    runId: run.id,
    status: run.status,
    duration: run.duration,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    errorDetails: run.errorDetails,
    artifactPaths: run.artifactPaths,
  };
}

function mapEventToStatus(event: NormalizedQueueEvent): string {
  switch (event.status) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "error":
      return "error";
    default:
      return "running";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  const runId = pathParts[pathParts.length - 1];

  if (!runId) {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
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

      const sendPayload = async (event: NormalizedQueueEvent) => {
        if (event.category !== "job" || event.queueJobId !== runId) {
          return;
        }

        const status = mapEventToStatus(event);
        const basePayload: Record<string, unknown> = {
          status,
          runId,
          jobId: event.entityId ?? runId,
          trigger: event.trigger,
        };

        if (status === "passed" || status === "failed" || status === "error") {
          const runDetails = await fetchRunDetails(runId);
          if (runDetails) {
            Object.assign(basePayload, runDetails);
          }
        }

        controller.enqueue(encoder.encode(serialize(basePayload)));
      };

      const unsubscribe = hub.subscribe(sendPayload);

      controller.enqueue(encoder.encode(": connected\n\n"));

      const initialDetails = await fetchRunDetails(runId);
      if (initialDetails) {
        controller.enqueue(
          encoder.encode(
            serialize({
              ...initialDetails,
              status: initialDetails.status ?? "running",
            })
          )
        );
      } else {
        controller.enqueue(
          encoder.encode(serialize({ status: "waiting", runId }))
        );
      }

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 30000);

      const cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new NextResponse(stream, { headers });
}
