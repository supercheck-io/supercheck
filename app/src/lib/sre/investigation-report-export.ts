export type SreInvestigationHistoryReportSource = {
  id: string;
  incidentId: string | null;
  incidentNumber: number | null;
  incidentTitle: string | null;
  serviceName: string | null;
  severity: string | null;
  incidentStatus: string | null;
  agentType: string;
  status: string;
  modelId: string;
  rootCauseHypothesis: string | null;
  confidenceScore: string | null;
  evidenceCount: number;
  toolCallCount: number;
  recommendationCount: number;
  estimatedCostCents: number | null;
  durationMs: number | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type SreInvestigationReportExport = {
  version: "sre-investigation-report.v1";
  exportedAt: string;
  run: {
    id: string;
    agentType: string;
    status: string;
    modelId: string;
    confidenceScore: string | null;
    rootCauseHypothesis: string | null;
    durationMs: number | null;
    estimatedCostCents: number | null;
    createdAt: string;
    completedAt: string | null;
  };
  incident: {
    id: string | null;
    number: number | null;
    title: string | null;
    severity: string | null;
    status: string | null;
  };
  service: {
    name: string | null;
  };
  evidence: Array<{
    id: string;
    title: string;
    summary: string | null;
    sourceType: string;
    evidenceType: string;
    severity: string | null;
    citationResultHash: string | null;
    observedAt: string | null;
    createdAt: string;
  }>;
  toolCalls: Array<{
    id: string;
    connectorType: string;
    toolName: string;
    status: string;
    inputHash: string;
    outputHash: string | null;
    evidenceItemId: string | null;
    durationMs: number | null;
    executedAt: string;
  }>;
  recommendations: Array<{
    id: string;
    recommendationText: string;
    stepCount: number | null;
    confidenceScore: string | null;
    applicationStatus: string;
    createdAt: string;
  }>;
  provenance: {
    evidenceCount: number;
    toolCallCount: number;
    recommendationCount: number;
    rawFieldsExcluded: string[];
  };
};

export type SreInvestigationExportEvidence = {
  id: string;
  investigationRunId: string | null;
  title: string;
  summary: string | null;
  sourceType: string;
  evidenceType: string;
  severity: string | null;
  citationResultHash: string | null;
  observedAt: Date | null;
  createdAt: Date;
};

export type SreInvestigationExportToolCall = {
  id: string;
  investigationRunId: string | null;
  connectorType: string;
  toolName: string;
  status: string;
  inputHash: string;
  outputHash: string | null;
  evidenceItemId: string | null;
  durationMs: number | null;
  executedAt: Date;
};

export type SreInvestigationExportRecommendation = {
  id: string;
  investigationRunId: string;
  recommendationText: string;
  stepCount: number | null;
  confidenceScore: string | null;
  applicationStatus: string;
  createdAt: Date;
};

const REPORT_EXPORT_RAW_FIELDS_EXCLUDED = [
  "promptInput",
  "agentStateSnapshot",
  "rawInputS3Path",
  "rawOutputS3Path",
  "rawContentS3Path",
  "rawContentExcerpt",
  "sourceUri",
  "inputSummary",
  "outputSummary",
];

function toIsoString(value: Date | null) {
  return value ? value.toISOString() : null;
}

function boundedReportText(value: string | null, maxLength = 1200) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

export function buildSreInvestigationReportExport(input: {
  item: SreInvestigationHistoryReportSource;
  evidence: SreInvestigationExportEvidence[];
  toolCalls: SreInvestigationExportToolCall[];
  recommendations: SreInvestigationExportRecommendation[];
  exportedAt?: Date;
}): SreInvestigationReportExport {
  const { item, evidence, toolCalls, recommendations, exportedAt = new Date() } = input;

  return {
    version: "sre-investigation-report.v1",
    exportedAt: exportedAt.toISOString(),
    run: {
      id: item.id,
      agentType: item.agentType,
      status: item.status,
      modelId: item.modelId,
      confidenceScore: item.confidenceScore,
      rootCauseHypothesis: boundedReportText(item.rootCauseHypothesis, 1200),
      durationMs: item.durationMs,
      estimatedCostCents: item.estimatedCostCents,
      createdAt: item.createdAt.toISOString(),
      completedAt: toIsoString(item.completedAt),
    },
    incident: {
      id: item.incidentId,
      number: item.incidentNumber,
      title: item.incidentTitle,
      severity: item.severity,
      status: item.incidentStatus,
    },
    service: {
      name: item.serviceName,
    },
    evidence: evidence.slice(0, 50).map((evidenceItem) => ({
      id: evidenceItem.id,
      title: boundedReportText(evidenceItem.title, 500) ?? "Untitled evidence",
      summary: boundedReportText(evidenceItem.summary),
      sourceType: evidenceItem.sourceType,
      evidenceType: evidenceItem.evidenceType,
      severity: evidenceItem.severity,
      citationResultHash: evidenceItem.citationResultHash,
      observedAt: toIsoString(evidenceItem.observedAt),
      createdAt: evidenceItem.createdAt.toISOString(),
    })),
    toolCalls: toolCalls.slice(0, 80).map((toolCall) => ({
      id: toolCall.id,
      connectorType: toolCall.connectorType,
      toolName: toolCall.toolName,
      status: toolCall.status,
      inputHash: toolCall.inputHash,
      outputHash: toolCall.outputHash,
      evidenceItemId: toolCall.evidenceItemId,
      durationMs: toolCall.durationMs,
      executedAt: toolCall.executedAt.toISOString(),
    })),
    recommendations: recommendations.slice(0, 25).map((recommendation) => ({
      id: recommendation.id,
      recommendationText: boundedReportText(recommendation.recommendationText, 1600) ?? "",
      stepCount: recommendation.stepCount,
      confidenceScore: recommendation.confidenceScore,
      applicationStatus: recommendation.applicationStatus,
      createdAt: recommendation.createdAt.toISOString(),
    })),
    provenance: {
      evidenceCount: evidence.length,
      toolCallCount: toolCalls.length,
      recommendationCount: recommendations.length,
      rawFieldsExcluded: REPORT_EXPORT_RAW_FIELDS_EXCLUDED,
    },
  };
}
