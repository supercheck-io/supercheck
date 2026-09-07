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

  const [text, finishReason] = await Promise.all([
    result.text,
    result.finishReason,
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
    finishReason,
  };
}
