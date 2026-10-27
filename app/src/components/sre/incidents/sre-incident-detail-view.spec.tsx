import { fireEvent, render, screen } from "@testing-library/react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";

import { SreIncidentDetailView } from "./sre-incident-detail-view";

jest.mock("@/components/sre/incidents/generate-evidence-brief-button", () => ({
  GenerateEvidenceBriefButton: () => (
    <button type="button">Generate brief</button>
  ),
}));

jest.mock("@/components/sre/incidents/edit-sre-incident-dialog", () => ({
  EditSreIncidentDialog: () => null,
}));

jest.mock("@/components/sre/incidents/resolve-sre-incident-dialog", () => ({
  OPEN_POSTMORTEM_EVENT: "incident:open-postmortem",
  ResolveSreIncidentDialog: ({ open }: { open?: boolean }) =>
    open === undefined ? <button>Resolve incident</button> : null,
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
  SreReportSnapshotControl: () => <div>Mock snapshot control</div>,
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
  it("has no tabs, shows the stepper, and keeps the investigation sheet closed by default", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("investigation-sheet")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#42");
    expect(screen.getByRole("navigation", { name: "Incident progress" }).querySelector("[aria-current=step]")).toHaveTextContent("Investigating");
    expect(screen.getByText("Checkout monitor down")).toBeInTheDocument();
    expect(screen.getByTestId("similar-incidents")).toHaveTextContent("Mock similar incidents");
  });

  it.each([
    ["investigation", "Mock AI investigation panel"],
    ["evidence", "Monitor timeout"],
    ["brief", "Brief summary"],
  ] as const)("opens the sheet on load for the legacy ?tab=%s link", (tab, text) => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} initialTab={tab} />);
    const sheet = screen.getByTestId("investigation-sheet");
    expect(sheet).toHaveTextContent(text);
  });

  it("opens the sheet from Investigation details and the actions menu holds the secondary links", async () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Investigation details" }));
    expect(screen.getByTestId("investigation-sheet")).toHaveTextContent("Run controls");
    fireEvent.keyDown(screen.getByTestId("investigation-sheet"), { key: "Escape" });
  });

  it("shows hypotheses, the step trace and one feedback control in the sheet", () => {
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
    render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    expect(screen.getByTestId("hypothesis-h1")).toHaveTextContent("Validated");
    expect(screen.getByTestId("hypothesis-h2")).toHaveTextContent("Ruled out");
    expect(screen.getAllByRole("button", { name: "View evidence: Monitor timeout" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Feedback: this investigation")).toHaveLength(1);
    expect(screen.getByTestId("investigation-step-trace")).toHaveAttribute("open");
  });

  it("offers the post-mortem only once the incident is resolved", () => {
    const open = render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    expect(screen.queryByRole("button", { name: "Post-mortem" })).not.toBeInTheDocument();
    open.unmount();
    const detail = detailFixture();
    detail.incident.status = "resolved";
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Post-mortem" }));
    expect(screen.getByText("Mock post-mortem")).toHaveAttribute("data-can-edit", "true");
  });

  it("leads with the AI summary, then the timeline, with ownership actions in the header", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    const summary = screen.getByTestId("incident-ai-summary");
    expect(summary).toHaveTextContent("Latency correlates with monitor failures.");
    expect(summary).toHaveTextContent("Confidence: Medium");
    expect(
      summary.compareDocumentPosition(screen.getByText("Mock timeline")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Owner: Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Post update" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add commander" })).toBeInTheDocument();
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
    expect(screen.queryByRole("link", { name: "Post update" })).not.toBeInTheDocument();
    expect(screen.getByTestId("resolution-summary")).toHaveTextContent("Rolled back the deploy.");
  });
});

describe("SreIncidentDetailView actions menu and primary button", () => {
  const openMenu = () => {
    const trigger = screen.getByRole("button", { name: "More actions" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.keyDown(trigger, { key: "Enter" });
  };

  it("gives editors Edit, Ask Copilot and Re-run investigation", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Ask Copilot" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Re-run investigation" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Resolve" })).toBeInTheDocument();
  });

  it("offers Run investigation when nothing has run yet", () => {
    const detail = detailFixture();
    detail.latestInvestigation = null;
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Run investigation" })).toBeInTheDocument();
  });

  it("hides Edit, Ask Copilot and Re-run from viewers but keeps the investigation map", () => {
    const detail = detailFixture();
    detail.permissions.canUpdate = false;
    detail.permissions.canInvestigate = false;
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Investigation map" })).toBeInTheDocument();
    for (const name of [/^Edit$/, /Ask Copilot/, /investigation$/i, /^Resolve$/]) {
      expect(screen.queryByRole("menuitem", { name })).not.toBeInTheDocument();
    }
  });

  it("shows Acknowledge, then Resolve, then Post-mortem as the incident progresses", () => {
    const fresh = render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve incident" })).not.toBeInTheDocument();
    fresh.unmount();

    const acked = detailFixture();
    acked.incident.acknowledgedAt = new Date("2026-06-24T12:10:00Z");
    const ackedView = render(<SreIncidentDetailView detail={acked} services={[]} />);
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve incident" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post-mortem" })).not.toBeInTheDocument();
    ackedView.unmount();

    const resolved = detailFixture();
    resolved.incident.status = "resolved";
    render(<SreIncidentDetailView detail={resolved} services={[]} />);
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve incident" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post-mortem" })).toBeInTheDocument();
  });

  it("shows no primary action to a viewer of an open incident", () => {
    const detail = detailFixture();
    detail.permissions.canUpdate = false;
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve incident" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post-mortem" })).not.toBeInTheDocument();
  });

  it("omits the resolution summary on open incidents and shows it once resolved", () => {
    const open = render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    expect(screen.queryByTestId("resolution-summary")).not.toBeInTheDocument();
    open.unmount();
    const detail = detailFixture();
    detail.incident.status = "resolved";
    detail.incident.resolutionSummary = "Scaled the pool.";
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    expect(screen.getByTestId("resolution-summary")).toHaveTextContent("Resolution: Scaled the pool.");
  });
});
