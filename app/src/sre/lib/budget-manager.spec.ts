import { assertSreAgentPromptWithinBudget, keepNewestWithinBudget, resolveSreAgentBudget } from "./budget-manager";

describe("SRE agent budget manager", () => {
  it("clamps requested budgets to production safety limits", () => {
    expect(resolveSreAgentBudget({ maxSteps: 99, maxOutputTokens: 99_999, timeoutMs: 999_999 })).toMatchObject({
      maxSteps: 8,
      maxOutputTokens: 4000,
      timeoutMs: 120_000,
    });
  });

  it("rejects oversized prompts", () => {
    expect(() => assertSreAgentPromptWithinBudget("x".repeat(11), { maxPromptChars: 10 })).toThrow("prompt exceeds");
  });

  it("keeps the newest items that fit, and always the newest one", () => {
    const length = (item: string) => item.length;
    expect(keepNewestWithinBudget(["aaaa", "bb", "cc"], length, 4)).toEqual(["bb", "cc"]);
    expect(keepNewestWithinBudget(["aaaa", "bb", "cc"], length, 100)).toEqual(["aaaa", "bb", "cc"]);
    expect(keepNewestWithinBudget(["aaaa", "bbbbbbbb"], length, 2)).toEqual(["bbbbbbbb"]);
  });
});
