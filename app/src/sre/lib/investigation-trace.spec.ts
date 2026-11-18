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
  it("keeps a short, sanitized reason for a tool that returned an error", () => {
    const [rejected, secret] = stepsFromModelStep(
      {
        toolCalls: [
          { toolCallId: "a", toolName: "searchLiveConnectorEvidence", input: { query: "logs for checkout-api" } },
          { toolCallId: "b", toolName: "searchLiveConnectorEvidence", input: {} },
        ],
        toolResults: [
          { toolCallId: "a", output: { error: true, message: `The connector rejected the query: parse error ${"x".repeat(300)}` } },
          { toolCallId: "b", output: { error: true, message: "Bearer abc.def" } },
        ],
      },
      0,
      100,
    );
    expect(rejected.status).toBe("error");
    expect(rejected.error).toMatch(/^The connector rejected the query: parse error x+\.\.\.$/);
    expect(rejected.error!.length).toBeLessThanOrEqual(160);
    expect(secret.error).toBe("[redacted]");
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
  it("reads a stored error reason and ignores a non-string one", () => {
    expect(readStoredSteps([{ tool: "t", status: "error", error: "timed out" }, { tool: "u", error: 5 }])).toEqual([
      { index: 0, tool: "t", args: "", status: "error", resultCount: null, durationMs: 0, error: "timed out" },
      { index: 0, tool: "u", args: "", status: "ok", resultCount: null, durationMs: 0 },
    ]);
  });
  it("keeps the reason of a tool that threw (tool-error part, no result)", () => {
    const [thrown, secret] = stepsFromModelStep(
      {
        toolCalls: [
          { toolCallId: "a", toolName: "searchLiveConnectorEvidence", input: {} },
          { toolCallId: "b", toolName: "searchLiveConnectorEvidence", input: {} },
        ],
        content: [
          { type: "tool-error", toolCallId: "a", error: new Error("connector timed out\n after 10s") },
          { type: "tool-error", toolCallId: "b", error: "Bearer abc.def" },
        ],
      },
      0,
      200,
    );
    expect(thrown.status).toBe("error");
    expect(thrown.error).toBe("connector timed out after 10s");
    expect(secret.error).toBe("[redacted]");
  });
  it("re-applies redaction to a stored reason on read", () => {
    const [step] = readStoredSteps([{ tool: "t", status: "error", error: "Bearer x" }]);
    expect(step.error).toBe("[redacted]");
  });
  it("never stores the raw arguments of an invalid tool call", () => {
    const err = Object.assign(new Error('Invalid input for tool q: Value: {"query":"jane@acme.com"}'), { name: "AI_InvalidToolInputError" });
    const [step] = stepsFromModelStep(
      { toolCalls: [{ toolCallId: "a", toolName: "q", input: {} }], content: [{ type: "tool-error", toolCallId: "a", error: err }] },
      0,
      10,
    );
    expect(step.error).toBe("The model called the tool with invalid input");
  });
  it("redacts connection strings and keeps the rest of a thrown reason, on write and on read", () => {
    const [step] = stepsFromModelStep(
      { toolCalls: [{ toolCallId: "a", toolName: "q", input: {} }], content: [{ type: "tool-error", toolCallId: "a", error: new Error("connect failed: postgres://u:hunter2@db.internal/app") }] },
      0,
      10,
    );
    expect(step.error).toContain("connect failed");
    expect(step.error).not.toContain("hunter2");
    const [read] = readStoredSteps([{ tool: "t", status: "error", error: "connect failed: postgres://u:hunter2@db.internal/app" }]);
    expect(read.error).not.toContain("hunter2");
  });
  it("keeps the reason of a tool result that returned an error", () => {
    const [step] = stepsFromModelStep(
      { toolCalls: [{ toolCallId: "a", toolName: "q", input: {} }], toolResults: [{ toolCallId: "a", output: { error: true, message: "rejected" } }] },
      0,
      10,
    );
    expect(step.error).toBe("rejected");
  });
});
