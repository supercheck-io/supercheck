export const STAGED_EVIDENCE_STAGES = [
  "statistics",
  "sample",
  "signatures",
  "temporal_context",
  "correlation",
] as const;

export type StagedEvidenceStage = (typeof STAGED_EVIDENCE_STAGES)[number];

const STAGED_LOG_CONNECTOR_TYPES = new Set(["loki"]);

export function isStagedLogConnectorType(connectorType: string) {
  return STAGED_LOG_CONNECTOR_TYPES.has(connectorType);
}

export function requiredPreviousEvidenceStage(stage: StagedEvidenceStage) {
  const index = STAGED_EVIDENCE_STAGES.indexOf(stage);
  return index > 0 ? STAGED_EVIDENCE_STAGES[index - 1] : null;
}

export function validateStagedEvidenceTransition(input: {
  stage: StagedEvidenceStage;
  completedStages: ReadonlySet<StagedEvidenceStage>;
}) {
  const required = requiredPreviousEvidenceStage(input.stage);
  if (required && !input.completedStages.has(required)) {
    throw new Error(
      `Complete the ${required.replace(/_/g, " ")} evidence stage before ${input.stage.replace(/_/g, " ")}.`,
    );
  }
}

export function stagedEvidenceToolName(stage: StagedEvidenceStage) {
  return `agent.connector.search.stage.${stage}`;
}

export function parseStagedEvidenceToolName(toolName: string) {
  const prefix = "agent.connector.search.stage.";
  const value = toolName.startsWith(prefix) ? toolName.slice(prefix.length) : null;
  return STAGED_EVIDENCE_STAGES.find((stage) => stage === value) ?? null;
}

export function boundedStageWindowMinutes(stage: StagedEvidenceStage, requestedMinutes: number) {
  if (stage === "statistics") return Math.min(requestedMinutes, 15);
  if (stage === "sample" || stage === "signatures") return Math.min(requestedMinutes, 30);
  return requestedMinutes;
}

export function validateStagedEvidenceQuery(input: {
  connectorType: string;
  stage: StagedEvidenceStage;
  query: string;
}) {
  if (input.connectorType === "loki" && input.stage === "statistics") {
    const isMetricLogQl = /\b(?:count_over_time|rate|bytes_rate|bytes_over_time)\s*\(/i.test(input.query);
    if (!isMetricLogQl) {
      throw new Error(
        "Loki statistics must use a bounded LogQL metric function such as count_over_time or rate.",
      );
    }
  }
}
