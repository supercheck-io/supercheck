import { generateText, tool, type LanguageModel } from "ai";
import { z } from "zod";

import { getProviderModel, validateAIConfiguration } from "@/lib/ai/ai-provider";
import { assertSreAgentPromptWithinBudget, resolveSreAgentBudget, type SreAgentBudgetInput } from "./budget-manager";

const subagentInputSchema = z.object({
  task: z.string().trim().min(1).max(2000),
  context: z.string().trim().max(6000).optional().default(""),
});

export type CreateSubagentToolInput = {
  description: string;
  system: string;
  budget?: SreAgentBudgetInput;
  model?: LanguageModel;
  validateConfiguration?: boolean;
};

export function createSubagentTool(input: CreateSubagentToolInput) {
  return tool({
    description: input.description,
    inputSchema: subagentInputSchema,
    execute: async ({ task, context }) => {
      const budget = resolveSreAgentBudget({ maxSteps: 1, maxOutputTokens: 900, timeoutMs: 30_000, ...input.budget });
      const prompt = ["Task:", task, context ? "Context:" : null, context || null].filter(Boolean).join("\n");
      assertSreAgentPromptWithinBudget(`${input.system}\n\n${prompt}`, budget);

      if (input.validateConfiguration !== false && !input.model) {
        validateAIConfiguration();
      }

      const result = await generateText({
        model: input.model ?? getProviderModel(),
        system: input.system,
        prompt,
        maxOutputTokens: budget.maxOutputTokens,
        abortSignal: AbortSignal.timeout(budget.timeoutMs),
      });

      return {
        text: result.text,
        finishReason: result.finishReason,
      };
    },
  });
}
