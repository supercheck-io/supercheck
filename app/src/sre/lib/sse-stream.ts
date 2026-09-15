const encoder = new TextEncoder();

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/i;

export type SseEvent = {
  event: string;
  data: unknown;
};

export function encodeSseEvent({ event, data }: SseEvent) {
  if (!EVENT_NAME_PATTERN.test(event)) {
    throw new Error("Invalid SSE event name");
  }

  const payload = JSON.stringify(data).replace(/[\u2028\u2029]/g, "");
  return encoder.encode(`event: ${event}\ndata: ${payload}\n\n`);
}

export function createSseStream(
  producer: (send: (event: string, data: unknown) => void) => Promise<void>
) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encodeSseEvent({ event, data }));
      };

      try {
        await producer(send);
        send("done", { ok: true });
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : "SRE stream failed",
        });
      } finally {
        controller.close();
      }
    },
  });
}

export function createSseResponse(stream: ReadableStream<Uint8Array>, init?: ResponseInit) {
  return new Response(stream, {
    ...init,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...init?.headers,
    },
  });
}
