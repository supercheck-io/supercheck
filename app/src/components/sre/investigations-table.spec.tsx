import { fireEvent, render, screen } from "@testing-library/react";

import { SreInvestigationsTable } from "./investigations-table";

const investigations = [
  {
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
    rootCauseHypothesis: "Database pool saturation is likely.",
    confidenceScore: "0.8000",
    evidenceCount: 3,
    toolCallCount: 2,
    recommendationCount: 1,
    estimatedCostCents: 50,
    durationMs: 12500,
    createdAt: new Date("2026-06-24T12:00:00Z"),
    completedAt: new Date("2026-06-24T12:00:12Z"),
  },
  {
    id: "018f0000-0000-7000-8000-000000000003",
    incidentId: "018f0000-0000-7000-8000-000000000004",
    incidentNumber: 43,
    incidentTitle: "Search timeout",
    serviceName: "search-api",
    severity: "sev3",
    incidentStatus: "triggered",
    agentType: "triage",
    status: "running",
    modelId: "test-model",
    rootCauseHypothesis: null,
    confidenceScore: null,
    evidenceCount: 0,
    toolCallCount: 0,
    recommendationCount: 0,
    estimatedCostCents: null,
    durationMs: null,
    createdAt: new Date("2026-06-24T13:00:00Z"),
    completedAt: null,
  },
];

describe("SreInvestigationsTable", () => {
  it("renders investigation rows and filters by query", () => {
    render(<SreInvestigationsTable investigations={investigations} />);

    expect(screen.getByText(/Checkout latency/)).toBeInTheDocument();
    expect(screen.getByText(/Search timeout/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search service, root cause, severity, model..."), {
      target: { value: "checkout" },
    });

    expect(screen.getByText(/Checkout latency/)).toBeInTheDocument();
    expect(screen.queryByText(/Search timeout/)).not.toBeInTheDocument();
  });

  it("shows load errors", () => {
    render(<SreInvestigationsTable investigations={[]} loadError="No access" />);

    expect(screen.getByText("SRE investigations unavailable")).toBeInTheDocument();
    expect(screen.getByText("No access")).toBeInTheDocument();
  });
});
