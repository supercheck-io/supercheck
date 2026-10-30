const encoder = new TextEncoder();

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/i;

/** An error whose message is safe to show the client; any other error is reported generically. */
export class SseClientError extends Error {}

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

/**
 * The producer receives an AbortSignal that fires when the client disconnects,
 * so long-running work (model calls, tool use) stops instead of running on.
 */
export function createSseStream(
  producer: (send: (event: string, data: unknown) => void, signal: AbortSignal) => Promise<void>
) {
  let cancelled = false;
  const disconnected = new AbortController();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (cancelled) return;
        controller.enqueue(encodeSseEvent({ event, data }));
      };

      try {
        await producer(send, disconnected.signal);
        send("done", { ok: true });
      } catch (error) {
        send("error", {
          message: error instanceof SseClientError ? error.message : "SRE stream failed",
        });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      disconnected.abort();
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
