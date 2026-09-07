import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

import { runSreAgent } from "./agent-runner";

const emptyUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

describe("runSreAgent", () => {
  it("rejects partial text when the provider finishes with an error", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "partial" },
            {
              type: "text-delta",
              id: "partial",
              delta: "Checking the evidence...",
            },
            { type: "text-end", id: "partial" },
            {
              type: "finish",
              finishReason: { unified: "error", raw: "error" },
              usage: emptyUsage,
            },
          ],
        }),
      }),
    });

    await expect(
      runSreAgent({
        model,
        validateConfiguration: false,
        system: "Read-only investigation",
        prompt: "Investigate checkout latency",
      }),
    ).rejects.toThrow("SRE agent did not complete successfully");
  });

  it("runs a bounded AI SDK v6 agent request with step auditing", async () => {
    const stepEvents: unknown[] = [];
    const model = new MockLanguageModelV3({
      provider: "supercheck-test",
      modelId: "sre-agent-runner-test",
      doStream: async (
        _options: LanguageModelV3CallOptions,
      ): Promise<LanguageModelV3StreamResult> => {
        const chunks: LanguageModelV3StreamPart[] = [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          {
            type: "text-delta",
            id: "text-1",
            delta: "Investigate checkout latency with read-only checks.",
          },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: emptyUsage,
          },
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

    expect(result.text).toBe(
      "Investigate checkout latency with read-only checks.",
    );
    expect(result.finishReason).toBe("stop");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(stepEvents).toHaveLength(1);
  });

  it("fails closed when the model ends on tool calls without a report", async () => {
    const model = new MockLanguageModelV3({
      provider: "supercheck-test",
      modelId: "sre-agent-empty-report-test",
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool-calls" },
              usage: emptyUsage,
            },
          ],
        }),
      }),
    });

    await expect(
      runSreAgent({
        model,
        validateConfiguration: false,
        system: "You are read-only.",
        prompt: "Investigate checkout latency",
        budget: { maxSteps: 2, maxOutputTokens: 500, timeoutMs: 10_000 },
      }),
    ).rejects.toThrow(
      "SRE agent returned no report (finish reason: tool-calls)",
    );
  });
});
