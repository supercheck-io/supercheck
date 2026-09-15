export type SreAgentBudgetInput = {
  maxSteps?: number;
  maxOutputTokens?: number;
  maxPromptChars?: number;
  timeoutMs?: number;
};

export type SreAgentBudget = {
  maxSteps: number;
  maxOutputTokens: number;
  maxPromptChars: number;
  timeoutMs: number;
};

const DEFAULT_BUDGET: SreAgentBudget = {
  maxSteps: 4,
  maxOutputTokens: 1200,
  maxPromptChars: 24_000,
  timeoutMs: 45_000,
};

const HARD_LIMITS: SreAgentBudget = {
  maxSteps: 8,
  maxOutputTokens: 4000,
  maxPromptChars: 64_000,
  timeoutMs: 120_000,
};

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

export function resolveSreAgentBudget(input: SreAgentBudgetInput = {}): SreAgentBudget {
  return {
    maxSteps: boundedInteger(input.maxSteps, DEFAULT_BUDGET.maxSteps, 1, HARD_LIMITS.maxSteps),
    maxOutputTokens: boundedInteger(input.maxOutputTokens, DEFAULT_BUDGET.maxOutputTokens, 128, HARD_LIMITS.maxOutputTokens),
    maxPromptChars: boundedInteger(input.maxPromptChars, DEFAULT_BUDGET.maxPromptChars, 1000, HARD_LIMITS.maxPromptChars),
    timeoutMs: boundedInteger(input.timeoutMs, DEFAULT_BUDGET.timeoutMs, 5000, HARD_LIMITS.timeoutMs),
  };
}

export function assertSreAgentPromptWithinBudget(prompt: string, budget: Pick<SreAgentBudget, "maxPromptChars">) {
  if (prompt.length > budget.maxPromptChars) {
    throw new Error(`SRE agent prompt exceeds ${budget.maxPromptChars} character budget`);
  }
}
