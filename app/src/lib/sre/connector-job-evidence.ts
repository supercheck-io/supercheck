import { z } from "zod";

const evidenceTypes = ["metric", "log", "trace", "artifact", "deployment", "event", "document", "topology"] as const;

const privateAgentEvidenceSummarySchema = z.object({
  id: z.string().trim().min(1).max(200),
  sourceUri: z.string().trim().min(1).max(1000),
  title: z.string().trim().min(1).max(500),
  summary: z.string().max(2000),
  evidenceType: z.enum(evidenceTypes),
  observedAt: z.string().datetime(),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/i),
});

export type PrivateAgentEvidenceSummary = z.infer<typeof privateAgentEvidenceSummarySchema> & {
  observedAtDate: Date;
};

export function normalizePrivateAgentEvidenceSummaries(
  resultSummary: Record<string, unknown> | null | undefined,
  maxItems = 100
): PrivateAgentEvidenceSummary[] {
  const evidence = Array.isArray(resultSummary?.evidence) ? resultSummary.evidence : [];

  return evidence.slice(0, maxItems).flatMap((item) => {
    const parsed = privateAgentEvidenceSummarySchema.safeParse(item);
    if (!parsed.success) {
      return [];
    }

    const observedAtDate = new Date(parsed.data.observedAt);
    if (Number.isNaN(observedAtDate.getTime())) {
      return [];
    }

    return [{ ...parsed.data, observedAtDate }];
  });
}
