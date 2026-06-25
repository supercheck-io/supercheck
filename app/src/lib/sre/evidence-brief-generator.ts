import { generateText } from "ai";
import { z } from "zod";

import { getActualModelName, getProviderModel, validateAIConfiguration } from "@/lib/ai/ai-provider";

export type BriefEvidenceInput = {
  id: string;
  title: string;
  summary: string | null;
  evidenceType: string;
  severity: string | null;
  confidence: string | null;
  sourceUri: string;
  rawContentExcerpt: string | null;
  observedAt: Date | null;
};

export type EvidenceBrief = {
  suspectedFailureDomain: string;
  summary: string;
  confidenceScore: number;
  citedEvidenceIds: string[];
  provider: "ai" | "fallback";
  modelId: string;
};

const briefSchema = z.object({
  suspectedFailureDomain: z.string().min(1).max(200),
  summary: z.string().min(1).max(3000),
  confidenceScore: z.number().min(0).max(1),
  citedEvidenceIds: z.array(z.string()).max(8),
});

function fallbackBrief(evidence: BriefEvidenceInput[], modelId = "fallback"): EvidenceBrief {
  const severe = evidence.find((item) => item.severity === "sev1" || item.severity === "sev2");
  const first = severe ?? evidence[0];

  if (!first) {
    return {
      suspectedFailureDomain: "Insufficient native evidence",
      summary: "No native SuperCheck evidence was available for this incident yet.",
      confidenceScore: 0.2,
      citedEvidenceIds: [],
      provider: "fallback",
      modelId,
    };
  }

  return {
    suspectedFailureDomain: first.evidenceType === "metric" ? "Monitoring signal" : "Execution artifact",
    summary: [
      "AI brief generation was unavailable, so this deterministic brief summarizes the strongest native evidence.",
      `${first.title}: ${first.summary ?? "No summary available."}`,
    ].join("\n\n"),
    confidenceScore: Number(first.confidence ?? 0.5),
    citedEvidenceIds: evidence.slice(0, 5).map((item) => item.id),
    provider: "fallback",
    modelId,
  };
}

function extractJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

export async function generateEvidenceBrief(input: {
  incidentTitle: string;
  incidentSeverity: string;
  evidence: BriefEvidenceInput[];
  userId: string;
  organizationId: string;
}): Promise<EvidenceBrief> {
  const modelId = getActualModelName();

  if (input.evidence.length === 0) {
    return fallbackBrief([], modelId);
  }

  try {
    validateAIConfiguration();

    const evidenceForPrompt = input.evidence.slice(0, 20).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      type: item.evidenceType,
      severity: item.severity,
      confidence: item.confidence,
      observedAt: item.observedAt?.toISOString() ?? null,
      sourceUri: item.sourceUri,
      excerpt: item.rawContentExcerpt,
    }));

    const prompt = `You are SuperCheck's read-only AI SRE assistant.

Create a concise incident evidence brief using ONLY the cited native SuperCheck evidence below. Do not invent external facts. If evidence is weak, say so.

Return JSON only with this exact shape:
{
  "suspectedFailureDomain": "short domain, e.g. monitor endpoint, job execution, k6 performance, unknown",
  "summary": "2-4 short paragraphs with concrete findings and uncertainty",
  "confidenceScore": 0.0,
  "citedEvidenceIds": ["evidence id strings used for the claims"]
}

Incident: ${input.incidentTitle}
Severity: ${input.incidentSeverity}
Evidence:
${JSON.stringify(evidenceForPrompt, null, 2)}`;

    const result = await generateText({
      model: getProviderModel(),
      prompt,
      temperature: 0.1,
      maxRetries: 2,
      maxOutputTokens: 1600,
      abortSignal: AbortSignal.timeout(45_000),
    });

    const parsed = briefSchema.safeParse(JSON.parse(extractJson(result.text)));
    if (!parsed.success) {
      return fallbackBrief(input.evidence, modelId);
    }

    const validIds = new Set(input.evidence.map((item) => item.id));
    return {
      ...parsed.data,
      citedEvidenceIds: parsed.data.citedEvidenceIds.filter((id) => validIds.has(id)),
      provider: "ai",
      modelId,
    };
  } catch (error) {
    console.warn("[SRE Evidence Brief] Falling back to deterministic brief:", error);
    return fallbackBrief(input.evidence, modelId);
  }
}
