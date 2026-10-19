import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { jobs, runs } from "@/db/schema";
import { getQueueEventHub, NormalizedQueueEvent } from "@/lib/queue-event-hub";
import { requireAuthContext } from "@/lib/auth-context";

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
    duration: run.durationMs,
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
    case "blocked":
      return "blocked";
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

  let projectContext: { project: { id: string }; organizationId: string };
  try {
    const context = await requireAuthContext();
    projectContext = { project: context.project, organizationId: context.organizationId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication required";
    const status = message.includes("Authentication") ? 401 : 404;
    return NextResponse.json({ error: message }, { status });
  }

  const runRecord = await db
    .select({
      runId: runs.id,
      runProjectId: runs.projectId,
      jobId: runs.jobId,
      jobOrgId: jobs.organizationId,
      jobProjectId: jobs.projectId,
    })
    .from(runs)
    .leftJoin(jobs, eq(jobs.id, runs.jobId))
    .where(eq(runs.id, runId))
    .limit(1);

  if (!runRecord.length) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const record = runRecord[0];
  const runProjectId = record.runProjectId ?? record.jobProjectId;

  if (
    !runProjectId ||
    runProjectId !== projectContext.project.id ||
    (record.jobOrgId && record.jobOrgId !== projectContext.organizationId)
  ) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable Nginx buffering for real-time SSE
  };

  let cleanupStream = () => {};
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      const hub = getQueueEventHub();
      await hub.ready();
      if (cancelled || request.signal.aborted) {
        controller.close();
        return;
      }

      // Track whether the stream has been closed to prevent
      // 'Controller is already closed' errors from async callbacks
      let isClosed = false;

      let keepAlive: ReturnType<typeof setInterval> | undefined;
      let unsubscribe = () => {};
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        request.signal.removeEventListener("abort", cleanup);
        isClosed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      cleanupStream = cleanup;
      request.signal.addEventListener("abort", cleanup);
      if (isClosed || cancelled || request.signal.aborted) cleanup();

      const safeEnqueue = (data: Uint8Array) => {
        if (isClosed || cancelled || request.signal.aborted) return;
        try {
          controller.enqueue(data);
        } catch {
          // Controller was closed between our check and enqueue
          isClosed = true;
          cleanupStream();
        }
      };

      const sendPayload = async (event: NormalizedQueueEvent) => {
        if (isClosed || cancelled || request.signal.aborted) return;
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

        if (status === "passed" || status === "failed" || status === "error" || status === "blocked") {
          const runDetails = await fetchRunDetails(runId);
          if (runDetails) {
            Object.assign(basePayload, runDetails);
          }
        }

        safeEnqueue(encoder.encode(serialize(basePayload)));
      };

      if (isClosed) return;
      unsubscribe = hub.subscribe(sendPayload);

      safeEnqueue(encoder.encode(": connected\n\n"));

      const initialDetails = await fetchRunDetails(runId).catch((error) => { cleanup(); throw error; });
      if (isClosed) return;
      if (initialDetails) {
        safeEnqueue(
          encoder.encode(
            serialize({
              ...initialDetails,
              status: initialDetails.status ?? "running",
            })
          )
        );
      } else {
        safeEnqueue(
          encoder.encode(serialize({ status: "waiting", runId }))
        );
      }

      keepAlive = setInterval(() => {
        safeEnqueue(encoder.encode(": ping\n\n"));
      }, 30000);


    },
    cancel() {
      cancelled = true;
      cleanupStream();
    },
  });

  return new NextResponse(stream, { headers });
}
