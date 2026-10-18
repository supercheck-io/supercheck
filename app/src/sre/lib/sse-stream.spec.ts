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
  it("allows an asynchronous producer to finish after the consumer cancels", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const stream = createSseStream(async (send) => {
      await gate;
      send("status", { phase: "finished" });
    });
    await stream.cancel();
    resume();
    await new Promise((resolve) => setTimeout(resolve, 0));
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
