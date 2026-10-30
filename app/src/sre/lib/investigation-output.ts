import { z } from "zod";

export const HYPOTHESIS_STATES = ["validated", "ruled_out", "inconclusive"] as const;
export type SreHypothesisState = (typeof HYPOTHESIS_STATES)[number];

/** Below this a stated root cause is reported as inconclusive rather than guessed. */
export const MIN_IDENTIFIED_CONFIDENCE = 0.3;
const MAX_TOP_EVIDENCE = 3;

const clip = (max: number) => z.string().trim().min(1).transform((value) => value.slice(0, max));
const UUID = z.string().uuid();

const hypothesisSchema = z.object({
  title: clip(160),
  state: z.enum(HYPOTHESIS_STATES),
  rationale: z.string().trim().default("").transform((value) => value.slice(0, 500)),
  // Malformed ids are dropped rather than failing the whole answer; real ids are verified against the incident later.
  evidenceIds: z
    .array(z.unknown())
    .default([])
    .transform((ids) => ids.flatMap((id) => (UUID.safeParse(id).success ? [id as string] : [])).slice(0, 5)),
});

// Small model slips (a sixth hypothesis, an over-long string, one bad hypothesis) are trimmed or dropped
// so the rest of the result survives. Confidence and outcome stay strict.
export const investigationOutputSchema = z.object({
  outcome: z.enum(["identified", "inconclusive"]),
  confidence: z.number().min(0).max(1),
  conclusion: clip(1500),
  hypotheses: z
    .array(z.unknown())
    .default([])
    .transform((list) =>
      list
        .slice(0, 20)
        .flatMap((entry) => {
          const parsed = hypothesisSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, 5),
    ),
  nextChecks: z
    .array(z.unknown())
    .default([])
    .transform((list) =>
      list.slice(0, 5).flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim().slice(0, 240)] : [])),
    ),
});

export type SreInvestigationHypothesis = {
  /** Stable per run (`h1`..`h5`, ranked order); feedback refers to it. */
  key: string;
  title: string;
  state: SreHypothesisState;
  rationale: string;
  evidenceIds: string[];
};

export type SreStructuredInvestigation = {
  outcome: "identified" | "inconclusive";
  /** 0 when inconclusive. */
  confidence: number;
  conclusion: string;
  hypotheses: SreInvestigationHypothesis[];
  nextChecks: string[];
  /** Up to three distinct evidence ids cited by validated hypotheses. */
  topEvidenceIds: string[];
  /** True when the model claimed a cause that the evidence rules could not support. */
  downgraded: boolean;
};

export type ParsedInvestigationOutput =
  | { ok: true; output: SreStructuredInvestigation }
  | { ok: false };

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) candidates.push(fenced[1].trim());
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/**
 * Validates the agent's final answer. Evidence ids must exist for the incident
 * (`knownEvidenceIds`); unknown citations are dropped. A cause is only
 * "identified" when a validated hypothesis keeps at least one real citation.
 */
export function parseInvestigationOutput(
  text: string,
  knownEvidenceIds: ReadonlySet<string>,
): ParsedInvestigationOutput {
  const raw = extractJson(text);
  const parsed = investigationOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };

  const hypotheses: SreInvestigationHypothesis[] = parsed.data.hypotheses.map((hypothesis, index) => {
    const evidenceIds = [...new Set(hypothesis.evidenceIds)].filter((id) => knownEvidenceIds.has(id));
    return {
      key: `h${index + 1}`,
      title: hypothesis.title,
      // A validated claim without a real citation is not validated.
      state: hypothesis.state === "validated" && evidenceIds.length === 0 ? "inconclusive" : hypothesis.state,
      rationale: hypothesis.rationale,
      evidenceIds,
    };
  });

  const supported = hypotheses.some((hypothesis) => hypothesis.state === "validated");
  const identified =
    parsed.data.outcome === "identified" && supported && parsed.data.confidence >= MIN_IDENTIFIED_CONFIDENCE;
  const topEvidenceIds = [
    ...new Set(hypotheses.filter((hypothesis) => hypothesis.state === "validated").flatMap((h) => h.evidenceIds)),
  ].slice(0, MAX_TOP_EVIDENCE);
  // Inconclusive runs still show what was reviewed, so the user can check the same evidence.
  const reviewedEvidenceIds = [...new Set(hypotheses.flatMap((h) => h.evidenceIds))].slice(0, MAX_TOP_EVIDENCE);

  return {
    ok: true,
    output: {
      outcome: identified ? "identified" : "inconclusive",
      confidence: identified ? Math.round(parsed.data.confidence * 10_000) / 10_000 : 0,
      conclusion: stripEvidenceIdLists(parsed.data.conclusion),
      hypotheses: hypotheses.map((h) => ({ ...h, rationale: stripEvidenceIdLists(h.rationale) })),
      nextChecks: parsed.data.nextChecks,
      topEvidenceIds: identified ? topEvidenceIds : reviewedEvidenceIds,
      downgraded: parsed.data.outcome === "identified" && !identified,
    },
  };
}

const EVIDENCE_ID_LIST = /\s*[[(](?:\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*[;,]?)+\s*[\])]/gi;

// Placeholder references with no real target, e.g. "(Evidence ID:(#))" and "([Log ID: <uuid>](#))".
const ID_LABEL = String.raw`(?:evidence|log)\s+ids?\s*:?`;
const EMPTY_ID_REFERENCE = new RegExp(
  [
    String.raw`\s*\(\s*${ID_LABEL}\s*\(#\)\s*\)`,
    String.raw`\s*\(\[\s*${ID_LABEL}\s*[0-9a-f-]{36}\s*\]\(#\)\)`,
    String.raw`\s*\[\s*${ID_LABEL}\s*[0-9a-f-]{36}\s*\]\(#\)`,
  ].join("|"),
  "gi",
);

/** Removes bracketed evidence-id lists the model inlines; citations are shown as chips instead. */
export function stripEvidenceIdLists(text: string) {
  return text.replace(EVIDENCE_ID_LIST, "").replace(EMPTY_ID_REFERENCE, "").replace(/[ \t]{2,}/g, " ").trim();
}

const STATE_LABEL: Record<SreHypothesisState, string> = {
  validated: "Validated",
  ruled_out: "Ruled out",
  inconclusive: "Inconclusive",
};

/** Markdown rendering kept in the run snapshot for exports and older readers. */
export function formatInvestigationMarkdown(output: SreStructuredInvestigation): string {
  const lines = [
    output.outcome === "inconclusive" ? "**Inconclusive.** " + output.conclusion : output.conclusion,
  ];
  if (output.hypotheses.length > 0) {
    lines.push("", "**Hypotheses**");
    for (const hypothesis of output.hypotheses) {
      const cites = hypothesis.evidenceIds.map((id) => `evidence ${id.slice(0, 8)}`).join(", ");
      lines.push(
        `- ${STATE_LABEL[hypothesis.state]}: ${hypothesis.title}${hypothesis.rationale ? ` - ${hypothesis.rationale}` : ""}${cites ? ` (${cites})` : ""}`,
      );
    }
  }
  if (output.nextChecks.length > 0) {
    lines.push("", "**Next safe checks**", ...output.nextChecks.map((check) => `- ${check}`));
  }
  return lines.join("\n");
}

/** Shape stored in sre_investigation_runs.hypotheses. */
export function toStoredHypotheses(output: SreStructuredInvestigation): Array<Record<string, unknown>> {
  return output.hypotheses.map((hypothesis) => ({ ...hypothesis }));
}

const storedHypothesisSchema = z.object({
  key: z.string().max(100),
  title: z.string(),
  state: z.enum(HYPOTHESIS_STATES),
  rationale: z.string().default(""),
  evidenceIds: z.array(z.string()).default([]),
});

/** Defensive read of the jsonb column; drops malformed entries. */
export function readStoredHypotheses(value: unknown): SreInvestigationHypothesis[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = storedHypothesisSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Label used in notifications: reveals confidence only, never evidence or conclusion text. */
export function confidenceNotificationDetail(output: SreStructuredInvestigation | null): string | undefined {
  if (!output) return undefined;
  if (output.outcome === "inconclusive") return "AI result: inconclusive";
  const label = output.confidence >= 0.75 ? "High" : output.confidence >= 0.5 ? "Medium" : "Low";
  return `AI confidence: ${label}`;
}
