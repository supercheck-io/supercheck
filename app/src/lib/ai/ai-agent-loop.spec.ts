import { streamText, stepCountIs, tool } from "ai";
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";

const emptyUsage = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 0,
    text: 0,
    reasoning: 0,
  },
};

describe("AI SDK agent loop", () => {
  it("executes a tool call and continues until the bounded stop condition", async () => {
    const executeLookup = jest.fn(async ({ service }: { service: string }) => ({
      service,
      status: "degraded",
    }));
    let streamCallCount = 0;

    const model = new MockLanguageModelV3({
      provider: "supercheck-test",
      modelId: "agent-loop-test-model",
      doStream: async (
        _options: LanguageModelV3CallOptions
      ): Promise<LanguageModelV3StreamResult> => {
        streamCallCount += 1;
        const chunks: LanguageModelV3StreamPart[] =
          streamCallCount === 1
            ? [
                { type: "stream-start", warnings: [] },
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "lookupService",
                  input: JSON.stringify({ service: "checkout" }),
                },
                {
                  type: "finish",
                  finishReason: { unified: "tool-calls", raw: "tool-calls" },
                  usage: emptyUsage,
                },
              ]
            : [
                { type: "stream-start", warnings: [] },
                { type: "text-start", id: "text-1" },
                {
                  type: "text-delta",
                  id: "text-1",
                  delta: "checkout is degraded",
                },
                { type: "text-end", id: "text-1" },
                {
                  type: "finish",
                  finishReason: { unified: "stop", raw: "stop" },
                  usage: emptyUsage,
                },
              ];

        return {
          stream: simulateReadableStream({
            chunks,
          }),
        };
      },
    });

    const result = streamText({
      model,
      prompt: "Investigate checkout latency",
      stopWhen: stepCountIs(2),
      tools: {
        lookupService: tool({
          description: "Look up service health.",
          inputSchema: z.object({
            service: z.string(),
          }),
          execute: executeLookup,
        }),
      },
    });

    await expect(result.text).resolves.toBe("checkout is degraded");
    await expect(result.finishReason).resolves.toBe("stop");
    expect(executeLookup).toHaveBeenCalledWith(
      expect.objectContaining({ service: "checkout" }),
      expect.anything()
    );
    expect(model.doStreamCalls).toHaveLength(2);
  });
});
