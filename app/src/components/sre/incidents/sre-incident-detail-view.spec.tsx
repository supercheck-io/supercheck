import { render, screen } from "@testing-library/react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";

import { SreIncidentDetailView } from "./sre-incident-detail-view";

jest.mock("@/components/sre/incidents/generate-evidence-brief-button", () => ({
  GenerateEvidenceBriefButton: () => <button type="button">Generate brief</button>,
}));

jest.mock("@/components/sre/incidents/sre-investigation-panel", () => ({
  SreInvestigationPanel: () => <div>Mock AI investigation panel</div>,
}));

function detailFixture(): SreIncidentDetail {
  const now = new Date("2026-06-24T12:00:00Z");

  return {
    incident: {
      id: "018f0000-0000-7000-8000-000000000001",
      incidentNumber: 42,
      title: "Checkout latency",
      severity: "sev2",
      status: "investigating",
      primaryServiceName: "checkout-api",
      alertCount: 2,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      rootCauseSummary: "Latency correlates with monitor failures.",
      confidenceScore: "0.7000",
    },
    latestBrief: {
      id: "018f0000-0000-7000-8000-000000000002",
      modelId: "test-model",
      status: "completed",
      rootCauseHypothesis: "Monitoring signal",
      confidenceScore: "0.7000",
      agentStateSnapshot: { provider: "ai", summary: "Brief summary" },
      completedAt: now,
      createdAt: now,
    },
    evidence: [
      {
        id: "ev-monitor-timeout",
        title: "Monitor timeout",
        summary: "Checkout monitor timed out.",
        sourceUri: "https://example.com/evidence",
        evidenceType: "event",
        severity: "sev2",
        confidence: "0.8000",
        rawContentExcerpt: null,
        citationQuery: "monitor_results.id = 1",
        observedAt: now,
        createdAt: now,
      },
    ],
    chatHistory: null,
    chatHistories: [],
  };
}

describe("SreIncidentDetailView", () => {
  it("renders the investigation workspace tabs and default AI panel", () => {
    render(<SreIncidentDetailView detail={detailFixture()} />);

    expect(screen.getByText("Investigation workspace")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "AI investigation" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Brief" })).toBeInTheDocument();
    expect(screen.getByText("Mock AI investigation panel")).toBeInTheDocument();
    expect(screen.getByText("Incident #42")).toBeInTheDocument();
  });
});
