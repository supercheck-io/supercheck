import { NextResponse } from "next/server";
import { getQueueEventHub, NormalizedQueueEvent } from "@/lib/queue-event-hub";

const encoder = new TextEncoder();

export async function GET(request: Request) {
  const headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };

  const stream = new ReadableStream({
    async start(controller) {
      const hub = getQueueEventHub();
      await hub.ready();

      const sendEvent = (event: NormalizedQueueEvent) => {
        if (event.category !== "job") {
          return;
        }

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
}
