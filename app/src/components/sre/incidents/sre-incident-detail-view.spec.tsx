import { fireEvent, render, screen } from "@testing-library/react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";

import { SreIncidentDetailView } from "./sre-incident-detail-view";

jest.mock("@/components/sre/incidents/generate-evidence-brief-button", () => ({
  GenerateEvidenceBriefButton: () => (
    <button type="button">Generate brief</button>
  ),
}));

jest.mock("@/components/sre/incidents/edit-sre-incident-dialog", () => ({
  EditSreIncidentDialog: () => <button type="button">Edit incident</button>,
}));

jest.mock("@/components/sre/incidents/resolve-sre-incident-dialog", () => ({
  ResolveSreIncidentDialog: () => <button>Resolve incident</button>,
}));

jest.mock("@/components/sre/incidents/incident-assignee-picker", () => ({
  IncidentAssigneePicker: ({ label = "Assignee", assigneeName }: { label?: string; assigneeName: string | null }) => (
    <div>{label}: {assigneeName ?? "Unassigned"}</div>
  ),
}));

jest.mock("@/components/sre/incidents/acknowledge-sre-incident-button", () => ({
  AcknowledgeSreIncidentButton: () => <button type="button">Acknowledge</button>,
}));

jest.mock("@/components/sre/incidents/incident-timeline", () => ({
  IncidentTimeline: () => <div>Mock timeline</div>,
}));

jest.mock("@/components/sre/incidents/investigation-feedback", () => ({
  InvestigationFeedback: ({ label }: { label: string }) => <div>Feedback: {label}</div>,
}));

jest.mock("@/components/sre/incidents/similar-incidents-card", () => ({
  SimilarIncidentsCard: () => <div data-testid="similar-incidents">Mock similar incidents</div>,
}));

jest.mock("@/components/sre/incidents/postmortem-card", () => ({
  PostmortemCard: ({ canEdit }: { canEdit: boolean }) => <div data-can-edit={canEdit}>Mock post-mortem</div>,
}));

jest.mock("@/components/sre/incidents/sre-investigation-panel", () => ({
  SreInvestigationPanel: ({ hasPrimaryService }: { hasPrimaryService: boolean }) => <div data-has-service={hasPrimaryService}>Mock AI investigation panel</div>,
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
      primaryServiceId: "018f0000-0000-7000-8000-000000000010",
      primaryServiceName: "checkout-api",
      assigneeUserId: "018f0000-0000-7000-8000-0000000000a1",
      assigneeName: "Ada Lovelace",
      assigneeImage: null,
      acknowledgedAt: null,
      acknowledgedByName: null,
      commanderUserId: null,
      commanderName: null,
      commanderImage: null,
      postmortem: null,
      mitigatedAt: null,
      resolutionSummary: null,
      alertCount: 2,
      evidenceCount: 1,
      investigationCount: 1,
      latestInvestigationStatus: "completed",
      latestInvestigationCompletedAt: now,
      latestInvestigationCreatedAt: now,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      rootCauseSummary: "Latency correlates with monitor failures.",
      confidenceScore: "0.7000",
    },
    linkedAlerts: [
      { id: "alert-1", title: "Checkout monitor down", severity: "sev2", status: "firing", role: "trigger", firedAt: now },
    ],
    currentUserId: "018f0000-0000-7000-8000-0000000000a1",
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
    latestInvestigation: {
      id: "018f0000-0000-7000-8000-000000000003",
      modelId: "test-model",
      status: "completed",
      summary: "Latency correlates with monitor failures.",
      completedAt: now,
      createdAt: now,
      structured: null,
      hypotheses: [],
      steps: [],
      myFeedback: [],
    },
    latestReportSnapshot: null,
    myReportFeedback: null,
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
    toolMetrics: {
      total: 3,
      errors: 1,
      averageDurationMs: 240,
    },
    permissions: {
      canUpdate: true,
      canInvestigate: true,
      canUseLiveConnectors: true,
    },
    capabilities: {
      investigationEnabled: true,
    },
  };
}

describe("SreIncidentDetailView", () => {
  it("uses the linked service ID even when its display name is missing", () => {
    const detail = detailFixture();
    detail.incident.primaryServiceName = null;
    render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    expect(screen.getByText("Mock AI investigation panel")).toHaveAttribute("data-has-service", "true");
  });
  it("hides resolution after the incident is resolved", () => {
    const detail = detailFixture();
    detail.incident.status = "resolved";
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    expect(
      screen.queryByRole("button", { name: "Resolve incident" }),
    ).not.toBeInTheDocument();
  });
  it("opens saved evidence without navigating to a private provider", () => {
    const detail = detailFixture();
    detail.evidence[0].sourceUri = "http://prometheus.aisre-lab:9090/graph";
    render(
      <SreIncidentDetailView
        detail={detail}
        services={[]}
        initialTab="evidence"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View evidence: Monitor timeout" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("monitor_results.id = 1")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open original source" }),
    ).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not render unsafe source links or interpret evidence as HTML", () => {
    const detail = detailFixture();
    detail.evidence[0].sourceUri = "javascript:alert(1)";
    detail.evidence[0].rawContentExcerpt = '<img src=x onerror="alert(1)">';
    render(
      <SreIncidentDetailView
        detail={detail}
        services={[]}
        initialTab="evidence"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View evidence: Monitor timeout" }),
    );
    expect(
      screen.queryByRole("link", { name: "Open original source" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(detail.evidence[0].rawContentExcerpt),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("img")).toBeNull();
  });

  it("shows a readable brief and hides generation from viewers", () => {
    const detail = detailFixture();
    detail.permissions.canInvestigate = false;
    detail.permissions.canUpdate = false;
    render(
      <SreIncidentDetailView
        detail={detail}
        services={[]}
        initialTab="brief"
      />,
    );
    expect(screen.getByText("Brief summary")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resolve incident" }),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByText("Evidence brief · Summarize or export evidence")
        .closest("details"),
    ).toHaveAttribute("open");
    expect(
      screen.queryByRole("button", { name: "Generate brief" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Expand evidence brief" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Evidence Brief" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });
  it("splits the incident into overview, investigation and evidence tabs", () => {
    const view = render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Investigation",
      "Evidence1",
    ]);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    view.unmount();
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} initialTab="investigation" />);
    expect(screen.getAllByRole("link", { name: "Investigation Map" })[0]).toHaveAttribute(
      "href",
      `/copilot/evidence-graph?incident=${detailFixture().incident.id}`,
    );
    expect(screen.getByText("Mock AI investigation panel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask Copilot" })).toHaveAttribute(
      "href",
      `/copilot?incident=${detailFixture().incident.id}`,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#42");
    expect(screen.getByText("Checkout monitor down")).toBeInTheDocument();
    expect(screen.getByTestId("similar-incidents")).toHaveTextContent("Mock similar incidents");
  });

  it("shows hypotheses on the overview and run feedback with the step trace on the investigation tab", () => {
    const detail = detailFixture();
    detail.latestInvestigation = {
      ...detail.latestInvestigation!,
      structured: {
        outcome: "identified",
        confidence: 0.82,
        conclusion: "Deploy 42 caused it.",
        nextChecks: [],
        topEvidenceIds: ["ev-monitor-timeout"],
        downgraded: false,
      },
      hypotheses: [
        { key: "h1", title: "Deploy 42 regression", state: "validated", rationale: "Timing matches", evidenceIds: ["ev-monitor-timeout"] },
        { key: "h2", title: "Database saturation", state: "ruled_out", rationale: "", evidenceIds: [] },
      ],
      steps: [{ index: 0, tool: "listNativeEvidence", args: "limit=10", status: "ok", resultCount: 1, durationMs: 120 }],
    };
    const overview = render(<SreIncidentDetailView detail={detail} services={[]} />);
    expect(screen.getByTestId("hypothesis-h1")).toHaveTextContent("Validated");
    expect(screen.getByTestId("hypothesis-h2")).toHaveTextContent("Ruled out");
    expect(screen.getAllByRole("button", { name: "View evidence: Monitor timeout" }).length).toBeGreaterThan(0);
    overview.unmount();
    render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    expect(screen.getByText("Feedback: this investigation")).toBeInTheDocument();
    expect(screen.getByTestId("investigation-step-trace")).toHaveAttribute("open");
  });

  it("offers the post-mortem only once the incident is resolved", () => {
    const open = render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    expect(screen.queryByText("Mock post-mortem")).not.toBeInTheDocument();
    open.unmount();
    const detail = detailFixture();
    detail.incident.status = "resolved";
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    expect(screen.getByText("Mock post-mortem")).toHaveAttribute("data-can-edit", "true");
  });

  it("leads with the AI summary, then the timeline, with ownership actions in the header", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    const summary = screen.getByTestId("incident-ai-summary");
    expect(summary).toHaveTextContent("Latency correlates with monitor failures.");
    expect(summary).toHaveTextContent("Medium confidence");
    expect(
      summary.compareDocumentPosition(screen.getByText("Mock timeline")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Assignee: Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Publish update" })).toBeInTheDocument();
  });

  it("hides acknowledge once acknowledged and shows MTTA in the sidebar", () => {
    const detail = detailFixture();
    detail.incident.acknowledgedAt = new Date("2026-06-24T12:10:00Z");
    detail.incident.acknowledgedByName = "Ada Lovelace";
    detail.incident.createdAt = new Date("2026-06-24T12:00:00Z");
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    expect(screen.getByText("10 min")).toBeInTheDocument();
  });

  it("hides ownership actions for read-only users and shows the resolution summary when resolved", () => {
    const detail = detailFixture();
    detail.permissions.canUpdate = false;
    detail.incident.status = "resolved";
    detail.incident.resolutionSummary = "Rolled back the deploy.";
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Publish update" })).not.toBeInTheDocument();
    expect(screen.getByTestId("resolution-summary")).toHaveTextContent("Rolled back the deploy.");
  });
});
