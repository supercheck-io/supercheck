import { streamText, stepCountIs, type LanguageModel, type ToolSet } from "ai";

import { getActualModelName, getProviderModel, validateAIConfiguration } from "@/lib/ai/ai-provider";
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
  const result = streamText({
    model: input.model ?? getProviderModel(),
    system,
    prompt,
    tools: input.tools,
    stopWhen: stepCountIs(budget.maxSteps),
    maxOutputTokens: budget.maxOutputTokens,
    abortSignal: AbortSignal.timeout(budget.timeoutMs),
    onStepFinish: input.onStepFinish
      ? async (event) => {
          stepIndex += 1;
          await input.onStepFinish?.({
            modelId,
            stepIndex,
            elapsedMs: Date.now() - startedAt,
            event,
          });
        }
      : undefined,
  });

  return {
    modelId,
    text: await result.text,
    finishReason: await result.finishReason,
  };
}
