import { readAiStream } from "./read-ai-stream";

const sse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
        controller.close();
      },
    })
  );
const ev = (o: object) => `data: ${JSON.stringify(o)}\n\n`;

describe("readAiStream", () => {
  it("reassembles events split across chunks", async () => {
    const full = ev({ type: "content", content: "hello " }) + ev({ type: "content", content: "world" }) + ev({ type: "done" });
    const updates: string[] = [];
    const text = await readAiStream(sse([full.slice(0, 20), full.slice(20, 61), full.slice(61)]), (t) => updates.push(t));
    expect(text).toBe("hello world");
    expect(updates).toEqual(["hello ", "hello world"]);
  });

  it("throws a generic message on an error event instead of swallowing it", async () => {
    const res = sse([ev({ type: "content", content: "partial" }), ev({ type: "error", error: "sk-secret provider detail" })]);
    await expect(readAiStream(res)).rejects.toThrow("AI generation failed. Please try again.");
  });

  it("throws when the stream ends without a done event", async () => {
    await expect(readAiStream(sse([ev({ type: "content", content: "cut off" })]))).rejects.toThrow("ended unexpectedly");
  });

  it("ignores malformed JSON lines", async () => {
    const text = await readAiStream(sse(["data: {not json}\n\n", ev({ type: "content", content: "ok" }), ev({ type: "done" })]));
    expect(text).toBe("ok");
  });

  it("accepts a final done event without a trailing newline", async () => {
    expect(await readAiStream(sse([ev({ type: "content", content: "x" }), 'data: {"type":"done"}']))).toBe("x");
  });
});
