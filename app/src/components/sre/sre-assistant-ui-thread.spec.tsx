import {
  createUserPromptMessage,
  formatCopilotError,
  getQuickRepliesForAssistantText,
  SRE_INLINE_CAPABILITIES_PREVIEW,
} from "./sre-generative-ui";

describe("getQuickRepliesForAssistantText", () => {
  it("suggests read-only recovery prompts after failures", () => {
    const replies = getQuickRepliesForAssistantText(
      "Connector check failed with a timeout while collecting evidence.",
    );

    expect(replies.map((reply) => reply.label)).toEqual([
      "Retry read-only check",
      "Try without connectors",
      "Show evidence",
    ]);
    expect(
      replies.every((reply) => !/delete|restart|patch/i.test(reply.prompt)),
    ).toBe(true);
  });

  it("suggests chart rendering for metric-heavy answers", () => {
    const replies = getQuickRepliesForAssistantText(
      "The p95 latency and memory metrics changed over the last 15 minutes.",
    );

    expect(replies).toContainEqual(
      expect.objectContaining({ label: "Render chart" }),
    );
  });
});

describe("SRE assistant-ui prompt helpers", () => {
  it("builds assistant-ui append messages with text content parts", () => {
    expect(createUserPromptMessage("/health Inspect current health")).toEqual({
      role: "user",
      content: [{ type: "text", text: "/health Inspect current health" }],
    });
  });

  it("formats JSON API errors as readable UI messages", () => {
    expect(
      formatCopilotError(new Error('{"error":"Invalid Copilot chat request"}')),
    ).toBe("Invalid Copilot chat request");
  });

  it("keeps deterministic inline preview content for chart QA", () => {
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain("```chart");
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain('"type":"line"');
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain('"type":"bar"');
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain('"type":"area"');
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain('"sources"');
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain("Generated preview data");
  });
});
