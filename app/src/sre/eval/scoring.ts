import type { SreEvalFixture } from "./fixtures";

export type SreEvalToolCall = {
  name: string;
  callId?: string;
};

export type SreEvalAgentResult = {
  answer: string;
  evidenceIds: string[];
  toolCalls: SreEvalToolCall[];
};

export type SreEvalScoreBreakdown = {
  keywordScore: number;
  evidenceScore: number;
  toolScore: number;
  forbiddenClaimScore: number;
  duplicateToolCallScore: number;
};

export type SreEvalFindingSeverity = "error" | "warning";

export type SreEvalFinding = {
  severity: SreEvalFindingSeverity;
  message: string;
};

export type SreEvalScore = {
  fixtureId: string;
  score: number;
  passed: boolean;
  breakdown: SreEvalScoreBreakdown;
  matched: {
    keywords: string[];
    evidenceIds: string[];
    toolNames: string[];
  };
  violations: {
    forbiddenClaims: string[];
    duplicateToolCalls: Record<string, number>;
  };
  findings: SreEvalFinding[];
};

const SCORE_WEIGHTS = {
  keywords: 0.3,
  evidence: 0.3,
  tools: 0.15,
  forbiddenClaims: 0.2,
  duplicateToolCalls: 0.05,
} as const;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function countMatches(expected: string[], candidates: string[]) {
  const normalizedCandidates = candidates.map(normalize);

  return expected.filter((expectedValue) => {
    const normalizedExpected = normalize(expectedValue);
    return normalizedCandidates.some((candidate) => candidate.includes(normalizedExpected));
  });
}

function ratio(matched: number, total: number) {
  if (total === 0) {
    return 1;
  }

  return matched / total;
}

function getDuplicateToolCalls(toolCalls: SreEvalToolCall[]) {
  const counts = toolCalls.reduce<Record<string, number>>((accumulator, toolCall) => {
    accumulator[toolCall.name] = (accumulator[toolCall.name] ?? 0) + 1;
    return accumulator;
  }, {});

  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 1));
}

function buildFindings(input: {
  fixture: SreEvalFixture;
  matchedKeywords: string[];
  matchedEvidenceIds: string[];
  matchedToolNames: string[];
  forbiddenClaims: string[];
  duplicateToolCalls: Record<string, number>;
}) {
  const findings: SreEvalFinding[] = [];
  const { fixture, matchedKeywords, matchedEvidenceIds, matchedToolNames, forbiddenClaims, duplicateToolCalls } = input;

  const missingKeywords = fixture.expected.requiredKeywords.filter((keyword) => !matchedKeywords.includes(keyword));
  if (missingKeywords.length > 0) {
    findings.push({ severity: "warning", message: `Missing expected keywords: ${missingKeywords.join(", ")}` });
  }

  const missingEvidenceIds = fixture.expected.requiredEvidenceIds.filter((evidenceId) => !matchedEvidenceIds.includes(evidenceId));
  if (missingEvidenceIds.length > 0) {
    findings.push({ severity: "error", message: `Missing required evidence citations: ${missingEvidenceIds.join(", ")}` });
  }

  const requiredToolNames = fixture.expected.requiredToolNames ?? [];
  const missingToolNames = requiredToolNames.filter((toolName) => !matchedToolNames.includes(toolName));
  if (missingToolNames.length > 0) {
    findings.push({ severity: "error", message: `Missing required tool calls: ${missingToolNames.join(", ")}` });
  }

  if (forbiddenClaims.length > 0) {
    findings.push({ severity: "error", message: `Used forbidden or unsupported claims: ${forbiddenClaims.join(", ")}` });
  }

  const duplicateNames = Object.keys(duplicateToolCalls);
  const maxDuplicateToolCalls = fixture.expected.maxDuplicateToolCalls ?? 1;
  const excessiveDuplicates = duplicateNames.filter((toolName) => duplicateToolCalls[toolName] > maxDuplicateToolCalls);
  if (excessiveDuplicates.length > 0) {
    findings.push({
      severity: "error",
      message: `Exceeded duplicate tool-call budget for: ${excessiveDuplicates.join(", ")}`,
    });
  }

  return findings;
}

export function scoreSreEvalResult(fixture: SreEvalFixture, result: SreEvalAgentResult): SreEvalScore {
  const answerCandidates = [result.answer, ...result.evidenceIds];
  const matchedKeywords = countMatches(fixture.expected.requiredKeywords, [result.answer]);
  const matchedEvidenceIds = countMatches(fixture.expected.requiredEvidenceIds, answerCandidates);
  const matchedToolNames = countMatches(
    fixture.expected.requiredToolNames ?? [],
    result.toolCalls.map((toolCall) => toolCall.name),
  );
  const forbiddenClaims = countMatches(fixture.expected.forbiddenClaims, [result.answer]);
  const duplicateToolCalls = getDuplicateToolCalls(result.toolCalls);
  const maxDuplicateToolCalls = fixture.expected.maxDuplicateToolCalls ?? 1;
  const hasExcessiveDuplicates = Object.values(duplicateToolCalls).some((count) => count > maxDuplicateToolCalls);

  const breakdown: SreEvalScoreBreakdown = {
    keywordScore: ratio(matchedKeywords.length, fixture.expected.requiredKeywords.length),
    evidenceScore: ratio(matchedEvidenceIds.length, fixture.expected.requiredEvidenceIds.length),
    toolScore: ratio(matchedToolNames.length, fixture.expected.requiredToolNames?.length ?? 0),
    forbiddenClaimScore: forbiddenClaims.length === 0 ? 1 : 0,
    duplicateToolCallScore: hasExcessiveDuplicates ? 0 : 1,
  };

  const score =
    breakdown.keywordScore * SCORE_WEIGHTS.keywords +
    breakdown.evidenceScore * SCORE_WEIGHTS.evidence +
    breakdown.toolScore * SCORE_WEIGHTS.tools +
    breakdown.forbiddenClaimScore * SCORE_WEIGHTS.forbiddenClaims +
    breakdown.duplicateToolCallScore * SCORE_WEIGHTS.duplicateToolCalls;

  const findings = buildFindings({
    fixture,
    matchedKeywords,
    matchedEvidenceIds,
    matchedToolNames,
    forbiddenClaims,
    duplicateToolCalls,
  });
  const hasError = findings.some((finding) => finding.severity === "error");

  return {
    fixtureId: fixture.id,
    score: Number(score.toFixed(4)),
    passed: score >= fixture.expected.minScore && !hasError,
    breakdown,
    matched: {
      keywords: matchedKeywords,
      evidenceIds: matchedEvidenceIds,
      toolNames: matchedToolNames,
    },
    violations: {
      forbiddenClaims,
      duplicateToolCalls,
    },
    findings,
  };
}
