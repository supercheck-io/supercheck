import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart, LanguageModelV3StreamResult } from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

import { runSreAgent } from "./agent-runner";

const emptyUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

describe("runSreAgent", () => {
  it("runs a bounded AI SDK v6 agent request with step auditing", async () => {
    const stepEvents: unknown[] = [];
    const model = new MockLanguageModelV3({
      provider: "supercheck-test",
      modelId: "sre-agent-runner-test",
      doStream: async (_options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
        const chunks: LanguageModelV3StreamPart[] = [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "Investigate checkout latency with read-only checks." },
          { type: "text-end", id: "text-1" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: emptyUsage },
        ];

        return { stream: simulateReadableStream({ chunks }) };
      },
    });

    const result = await runSreAgent({
      model,
      validateConfiguration: false,
      system: "You are read-only.",
      prompt: "Investigate checkout latency",
      budget: { maxSteps: 2, maxOutputTokens: 500, timeoutMs: 10_000 },
      onStepFinish: (event) => {
        stepEvents.push(event);
      },
    });

    expect(result.text).toBe("Investigate checkout latency with read-only checks.");
    expect(result.finishReason).toBe("stop");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(stepEvents).toHaveLength(1);
  });
});
