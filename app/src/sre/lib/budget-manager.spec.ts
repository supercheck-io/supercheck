import { assertSreAgentPromptWithinBudget, resolveSreAgentBudget } from "./budget-manager";

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
});
