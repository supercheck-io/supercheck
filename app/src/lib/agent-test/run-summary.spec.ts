import { sanitizeAgentSummary } from "./run-summary";

describe("sanitizeAgentSummary", () => {
  it("returns undefined without a summary", () => {
    expect(sanitizeAgentSummary(null)).toBeUndefined();
    expect(sanitizeAgentSummary({ agent: "x" })).toBeUndefined();
    expect(sanitizeAgentSummary({ agent: null })).toBeUndefined();
    expect(sanitizeAgentSummary({ agent: { tests: "x" } })).toBeUndefined();
  });

  it("keeps numbers and tool names, caps lists and clips messages, dropping everything else", () => {
    const out = sanitizeAgentSummary({
      agent: {
        tests: [
          {
            testId: "t", title: "bot", attempts: 10, passed: 7, passRate: 0.7, totalTokens: 100, judgeTokens: 5, toolNames: Array.from({ length: 60 }, (_, i) => `tool${i}`), durationMs: 9, slowestMs: 3,
            failures: Array.from({ length: 8 }, (_, i) => ({ attempt: i, message: "x".repeat(500), prompt: "SECRET" })),
            transcript: "SECRET", attempts_detail: [{ reply: "SECRET" }],
          },
          ...Array.from({ length: 30 }, () => ({ title: "t", attempts: "NaN", passRate: Infinity })),
        ],
      },
    })!;
    expect(out.tests).toHaveLength(20);
    expect(out.tests[0].toolNames).toHaveLength(50);
    expect(out.tests[0].failures).toHaveLength(5);
    expect(out.tests[0].failures[0].message).toHaveLength(200);
    expect(out.tests[1]).toMatchObject({ attempts: 0, passRate: 0 });
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });

  it("lets the caller redact text", () => {
    const out = sanitizeAgentSummary({ agent: { tests: [{ title: "a", failures: [{ attempt: 1, message: "key sk-123" }] }] } }, (v) => v.replace(/sk-\d+/g, "[redacted]"))!;
    expect(out.tests[0].failures[0].message).toBe("key [redacted]");
  });
});
