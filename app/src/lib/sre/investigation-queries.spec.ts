import { buildSreInvestigationReportExport, type SreInvestigationHistoryReportSource } from "./investigation-report-export";

const investigationItem: SreInvestigationHistoryReportSource = {
  id: "018f0000-0000-7000-8000-000000000001",
  incidentId: "018f0000-0000-7000-8000-000000000002",
  incidentNumber: 42,
  incidentTitle: "Checkout latency",
  serviceName: "checkout-api",
  severity: "sev2",
  incidentStatus: "investigating",
  agentType: "investigation",
  status: "completed",
  modelId: "test-model",
  rootCauseHypothesis: "Database pool saturation\u0000 is likely.",
  confidenceScore: "0.8000",
  evidenceCount: 1,
  toolCallCount: 1,
  recommendationCount: 1,
  estimatedCostCents: 50,
  durationMs: 12500,
  createdAt: new Date("2026-06-24T12:00:00Z"),
  completedAt: new Date("2026-06-24T12:00:12Z"),
};

describe("buildSreInvestigationReportExport", () => {
  it("builds a bounded sanitized report export without raw connector fields", () => {
    const report = buildSreInvestigationReportExport({
      item: investigationItem,
      exportedAt: new Date("2026-06-24T12:01:00Z"),
      evidence: [
        {
          id: "ev-checkout-5xx",
          investigationRunId: investigationItem.id,
          title: "Checkout 5xx spike",
          summary: "Prometheus 5xx rate stayed above threshold.",
          sourceType: "prometheus",
          evidenceType: "metric",
          severity: "sev2",
          citationResultHash: "hash-evidence",
          observedAt: new Date("2026-06-24T11:59:00Z"),
          createdAt: new Date("2026-06-24T12:00:02Z"),
        },
      ],
      toolCalls: [
        {
          id: "tool-call-1",
          investigationRunId: investigationItem.id,
          connectorType: "prometheus",
          toolName: "prometheus.query_range",
          status: "success",
          inputHash: "hash-input",
          outputHash: "hash-output",
          evidenceItemId: "ev-checkout-5xx",
          durationMs: 320,
          executedAt: new Date("2026-06-24T12:00:01Z"),
        },
      ],
      recommendations: [
        {
          id: "rec-1",
          investigationRunId: investigationItem.id,
          recommendationText: "Verify checkout recovery after resizing the database pool.",
          stepCount: 2,
          confidenceScore: "0.7000",
          applicationStatus: "pending",
          createdAt: new Date("2026-06-24T12:00:10Z"),
        },
      ],
    });

    expect(report).toMatchObject({
      version: "sre-investigation-report.v1",
      exportedAt: "2026-06-24T12:01:00.000Z",
      run: {
        id: investigationItem.id,
        rootCauseHypothesis: "Database pool saturation is likely.",
      },
      evidence: [
        {
          id: "ev-checkout-5xx",
          citationResultHash: "hash-evidence",
        },
      ],
      toolCalls: [
        {
          id: "tool-call-1",
          inputHash: "hash-input",
          outputHash: "hash-output",
        },
      ],
      provenance: {
        evidenceCount: 1,
        toolCallCount: 1,
        recommendationCount: 1,
      },
    });
    expect(report.provenance.rawFieldsExcluded).toEqual(expect.arrayContaining(["rawInputS3Path", "rawOutputS3Path", "rawContentExcerpt", "sourceUri"]));
    expect(JSON.stringify(report)).not.toContain("rawInputS3PathValue");
  });
});
