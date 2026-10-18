import { createSseStream, encodeSseEvent } from "./sse-stream";

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    output += decoder.decode(chunk.value);
  }

  return output;
}

describe("SRE SSE stream", () => {
  it("aborts the producer's signal when the consumer cancels and tolerates late sends", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let observedSignal: AbortSignal | undefined;
    let finished = false;
    let failure: unknown;
    const stream = createSseStream(async (send, signal) => {
      observedSignal = signal;
      await gate;
      try {
        send("status", { phase: "finished" });
        finished = true;
      } catch (error) {
        failure = error;
      }
    });
    const reader = stream.getReader();
    const first = reader.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observedSignal?.aborted).toBe(false);
    await reader.cancel();
    expect(observedSignal?.aborted).toBe(true);
    resume();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finished).toBe(true);
    expect(failure).toBeUndefined();
    await expect(first).resolves.toMatchObject({ done: true });
  });
  it("encodes JSON SSE events", () => {
    const encoded = new TextDecoder().decode(encodeSseEvent({ event: "message", data: { ok: true } }));

    expect(encoded).toBe('event: message\ndata: {"ok":true}\n\n');
  });

  it("rejects invalid event names", () => {
    expect(() => encodeSseEvent({ event: "bad name", data: {} })).toThrow("Invalid SSE event name");
  });

  it("closes with done after producer completes", async () => {
    const output = await readStream(createSseStream(async (send) => {
      send("status", { phase: "running" });
    }));

    expect(output).toContain("event: status");
    expect(output).toContain("event: done");
  });
});
