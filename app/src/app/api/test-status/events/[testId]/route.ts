import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { reports } from "@/db/schema";
import { getQueueEventHub, NormalizedQueueEvent } from "@/lib/queue-event-hub";

const encoder = new TextEncoder();

const serialize = (payload: Record<string, unknown>) =>
  `data: ${JSON.stringify(payload)}\n\n`;

async function fetchReport(testId: string) {
  return db.query.reports.findFirst({
    where: and(
      eq(reports.entityType, "test"),
      eq(reports.entityId, testId)
    ),
  });
}

const terminalStatuses = new Set(["passed", "failed", "error", "completed"]);

const deriveFinalStatus = (
  queueStatus: string,
  reportStatus?: string | null
): string => {
  const normalizedQueue = queueStatus.toLowerCase();
  const normalizedReport = reportStatus?.toLowerCase?.() || null;

  // Fail-fast if either source says failed/error
  if (
    normalizedQueue === "failed" ||
    normalizedQueue === "error" ||
    normalizedReport === "failed" ||
    normalizedReport === "error"
  ) {
    return "failed";
  }

  // Only treat as passed when the report explicitly says passed
  if (normalizedReport === "passed") {
    return "passed";
  }

  // If queue claims passed but we lack report confirmation, degrade to failed-safe
  if (normalizedQueue === "passed") {
    return "failed";
  }

  // Otherwise return the queue status (running/completed/etc.)
  return normalizedQueue;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  const testId = pathParts[pathParts.length - 1];

  if (!testId) {
    return NextResponse.json({ error: "Missing testId" }, { status: 400 });
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

      const send = async (event: NormalizedQueueEvent) => {
        if (event.category !== "test") {
          return;
        }

        const eventTestId = event.entityId ?? event.queueJobId;

        if (eventTestId !== testId) {
          return;
        }

        const status = event.status;
        let reportStatus: string | null = null;
        const payload: Record<string, unknown> = {
          status,
          derivedStatus: status,
          testId,
          queueJobId: event.queueJobId,
        };

        if (terminalStatuses.has(status)) {
          const report = await fetchReport(testId);
          if (report) {
            payload.reportPath = report.reportPath;
            payload.s3Url = report.s3Url;
            payload.reportStatus = report.status;
            reportStatus = report.status;
          }
        }

        payload.derivedStatus = deriveFinalStatus(status, reportStatus);
        controller.enqueue(encoder.encode(serialize(payload)));
      };

      const unsubscribe = hub.subscribe(send);
      controller.enqueue(encoder.encode(": connected\n\n"));

      const initialReport = await fetchReport(testId);
      if (initialReport) {
        const initStatus = initialReport.status ?? "running";
        controller.enqueue(
          encoder.encode(
            serialize({
              status: initStatus,
              reportStatus: initStatus,
              derivedStatus: deriveFinalStatus(initStatus, initStatus),
              testId,
              reportPath: initialReport.reportPath,
              s3Url: initialReport.s3Url,
            })
          )
        );
      } else {
        controller.enqueue(
          encoder.encode(serialize({ status: "waiting", derivedStatus: "waiting", testId }))
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
