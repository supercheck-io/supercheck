import { generateText, type LanguageModel } from "ai";
import { z } from "zod";

import { getActualModelName, getProviderModel, validateAIConfiguration } from "@/lib/ai/ai-provider";
import { redactConnectorText } from "@/lib/sre/connectors";
import type { SreEvalFixture } from "./fixtures";
import type { SreEvalAgentResult, SreEvalScore } from "./scoring";

const MAX_GRADER_INPUT_CHARS = 12_000;
const MAX_ANSWER_CHARS = 4_000;

const modelGradeSchema = z.object({
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
  findings: z.array(z.string().trim().min(1).max(300)).max(10),
  rationale: z.string().trim().min(1).max(1_000),
});

export type SreModelEvalGrade = z.infer<typeof modelGradeSchema> & {
  modelId: string;
  finishReason: string;
};

export type GradeSreEvalResultWithModelInput = {
  fixture: SreEvalFixture;
  agentResult: SreEvalAgentResult;
  deterministicScore: SreEvalScore;
  evaluatedModelId?: string;
  graderModelId?: string;
  model?: LanguageModel;
  validateConfiguration?: boolean;
  allowSameModel?: boolean;
  timeoutMs?: number;
};

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function safeJson(value: unknown) {
  return redactConnectorText(JSON.stringify(value, null, 2));
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("SRE eval model grader returned no JSON object");
  }

  return candidate.slice(start, end + 1);
}

export function buildSreEvalModelGraderPrompt(input: GradeSreEvalResultWithModelInput) {
  const payload = {
    fixture: {
      id: input.fixture.id,
      milestone: input.fixture.milestone,
      title: input.fixture.title,
      prompt: input.fixture.prompt,
      expected: input.fixture.expected,
    },
    deterministicScore: input.deterministicScore,
    agentResult: {
      answer: truncate(redactConnectorText(input.agentResult.answer), MAX_ANSWER_CHARS),
      evidenceIds: input.agentResult.evidenceIds.slice(0, 50),
      toolCalls: input.agentResult.toolCalls.slice(0, 50),
    },
  };

  return truncate(
    [
      "Grade this SuperCheck SRE investigation eval result.",
      "You are an independent grader. Do not add new incident facts. Use only the supplied fixture, deterministic score, and agent result.",
      "Fail the result if it claims production remediation was performed, cites missing evidence, invents connector checks, or omits required evidence/tool usage.",
      "Return strict JSON only with this shape: {\"score\": number 0..1, \"passed\": boolean, \"confidence\": \"low\"|\"medium\"|\"high\", \"findings\": string[], \"rationale\": string}.",
      safeJson(payload),
    ].join("\n\n"),
    MAX_GRADER_INPUT_CHARS
  );
}

export async function gradeSreEvalResultWithModel(input: GradeSreEvalResultWithModelInput): Promise<SreModelEvalGrade> {
  const graderModelId = input.graderModelId ?? getActualModelName();

  if (input.evaluatedModelId && input.evaluatedModelId === graderModelId && input.allowSameModel !== true) {
    throw new Error("SRE eval model grader must use a different model from the evaluated model");
  }

  if (input.validateConfiguration !== false && !input.model) {
    validateAIConfiguration();
  }

  const result = await generateText({
    model: input.model ?? getProviderModel(),
    system:
      "You are a strict, independent evaluator for read-only SRE agent outputs. Return JSON only. Never include secrets or reproduce credentials.",
    prompt: buildSreEvalModelGraderPrompt(input),
    maxOutputTokens: 800,
    abortSignal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
  });

  const parsedJson = JSON.parse(extractJsonObject(result.text)) as unknown;
  const grade = modelGradeSchema.parse(parsedJson);

  return {
    ...grade,
    modelId: graderModelId,
    finishReason: result.finishReason,
  };
}
