import { readStoredSteps, stepsFromModelStep, summarizeToolArgs } from "./investigation-trace";

describe("summarizeToolArgs", () => {
  it("redacts secret-named keys and truncates long values", () => {
    const summary = summarizeToolArgs({ apiKey: "sk-live-123", token: "abc", query: "x".repeat(200), limit: 5 });
    expect(summary).not.toContain("sk-live-123");
    expect(summary).toContain("apiKey=[redacted]");
    expect(summary).toContain("limit=5");
    expect(summary.length).toBeLessThanOrEqual(160);
  });
  it("redacts credential-looking values under innocent key names", () => {
    const summary = summarizeToolArgs({
      query: "Bearer abc.def.ghi",
      note: "eyJhbGciOiJIUzI1NiJ9.payload.sig",
      id: "sck_live_1234567890abcdef",
      blob: "A".repeat(40),
      service: "checkout-api",
    });
    expect(summary).toBe("query=[redacted], note=[redacted], id=[redacted], blob=[redacted], service=checkout-api");
  });
  it("returns empty for non-object input", () => {
    expect(summarizeToolArgs(null)).toBe("");
    expect(summarizeToolArgs("raw")).toBe("");
  });
});

describe("stepsFromModelStep", () => {
  it("maps calls to status, count and duration without storing results", () => {
    const steps = stepsFromModelStep(
      {
        toolCalls: [
          { toolCallId: "a", toolName: "listNativeEvidence", input: { limit: 10 } },
          { toolCallId: "b", toolName: "searchLiveConnectorEvidence", input: { query: "up" } },
          { toolCallId: "c", toolName: "listConnectorEvidence", input: {} },
        ],
        toolResults: [
          { toolCallId: "a", output: { evidence: [{ id: 1 }, { id: 2 }] } },
          { toolCallId: "c", output: { evidence: [] } },
        ],
        content: [{ type: "tool-error", toolCallId: "b" }],
      },
      3,
      900,
    );
    expect(steps.map((s) => [s.index, s.status, s.resultCount, s.durationMs])).toEqual([
      [3, "ok", 2, 300],
      [4, "error", null, 300],
      [5, "empty", 0, 300],
    ]);
    expect(JSON.stringify(steps)).not.toContain("output");
  });
  it("returns nothing for a text-only step", () => {
    expect(stepsFromModelStep({ toolCalls: [] }, 0, 100)).toEqual([]);
  });
});

describe("readStoredSteps", () => {
  it("is defensive about malformed jsonb", () => {
    expect(readStoredSteps(undefined)).toEqual([]);
    expect(readStoredSteps([{ tool: "t", status: "weird" }, 3, { x: 1 }])).toEqual([
      { index: 0, tool: "t", args: "", status: "ok", resultCount: null, durationMs: 0 },
    ]);
  });
});
