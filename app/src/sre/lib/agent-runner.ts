import { streamText, stepCountIs, type LanguageModel, type ToolSet } from "ai";

import { getActualModelName, getProviderModel, validateAIConfiguration } from "@/lib/ai/ai-provider";
import { logger } from "@/lib/logger/index";
import { assertSreAgentPromptWithinBudget, resolveSreAgentBudget, type SreAgentBudgetInput } from "./budget-manager";

export type SreAgentRunEvent = {
  modelId: string;
  stepIndex: number;
  elapsedMs: number;
  event: unknown;
};

export type RunSreAgentInput<TTools extends ToolSet = ToolSet> = {
  system: string;
  prompt: string;
  tools?: TTools;
  budget?: SreAgentBudgetInput;
  model?: LanguageModel;
  validateConfiguration?: boolean;
  onStepFinish?: (event: SreAgentRunEvent) => void | Promise<void>;
};

export class SreAgentEmptyResponseError extends Error {
  constructor(readonly finishReason: string) {
    super(
      `SRE agent returned no report (finish reason: ${finishReason || "unknown"})`,
    );
    this.name = "SreAgentEmptyResponseError";
  }
}

export async function runSreAgent<TTools extends ToolSet = ToolSet>(input: RunSreAgentInput<TTools>) {
  const budget = resolveSreAgentBudget(input.budget);
  const prompt = input.prompt.trim();
  const system = input.system.trim();

  assertSreAgentPromptWithinBudget(`${system}\n\n${prompt}`, budget);

  if (input.validateConfiguration !== false && !input.model) {
    validateAIConfiguration();
  }

  const startedAt = Date.now();
  let stepIndex = 0;
  const modelId = getActualModelName();
  const abortSignal = AbortSignal.timeout(budget.timeoutMs);
  const result = streamText({
    model: input.model ?? getProviderModel(),
    system,
    prompt,
    tools: input.tools,
    stopWhen: stepCountIs(budget.maxSteps),
    maxOutputTokens: budget.maxOutputTokens,
    abortSignal,
    onStepFinish: async (event) => {
      stepIndex += 1;
      // Record counts only, never prompts, evidence, tool arguments, or responses.
      // Includes specialist calls and completed steps of subsequently failed runs.
      logger.info({
        module: "sre-agent-usage",
        modelId,
        stepIndex,
        elapsedMs: Date.now() - startedAt,
        inputTokens: event.usage.inputTokens ?? null,
        outputTokens: event.usage.outputTokens ?? null,
        totalTokens: event.usage.totalTokens ?? null,
        finishReason: event.finishReason,
      }, "SRE model step usage");
      await input.onStepFinish?.({
        modelId,
        stepIndex,
        elapsedMs: Date.now() - startedAt,
        event,
      });
    },
  });

  const [text, finishReason, usage] = await Promise.all([
    result.text,
    result.finishReason,
    result.totalUsage,
  ]);
  // Streams can resolve partial text after a provider error or cancellation.
  // Such output must not become a completed, billable investigation.
  abortSignal.throwIfAborted();
  if (finishReason === "error") {
    throw new Error("SRE agent did not complete successfully");
  }
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new SreAgentEmptyResponseError(finishReason);
  }

  return {
    modelId,
    text: normalizedText,
    usage: {
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      totalTokens: usage.totalTokens ?? null,
    },
    finishReason,
  };
}
