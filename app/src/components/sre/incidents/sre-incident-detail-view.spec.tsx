import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";

import { defaultResolutionNote, SreIncidentDetailView } from "./sre-incident-detail-view";

type StreamProps = {
  onStreamStart?: () => void;
  onStreamContent?: (chunk: string) => void;
  onStreamDone?: (result: { brief?: { summary: string; provider: "ai" | "fallback"; confidenceScore: number } }) => void;
  onStreamError?: (message: string) => void;
};
let briefStreamFails = false;
jest.mock("@/components/sre/incidents/generate-evidence-brief-button", () => ({
  GenerateEvidenceBriefButton: ({ onStreamStart, onStreamContent, onStreamDone, onStreamError }: StreamProps) => (
    <button
      type="button"
      onClick={() => {
        onStreamStart?.();
        onStreamContent?.("Partial");
        if (briefStreamFails) onStreamError?.("failed");
        else onStreamDone?.({ brief: { summary: "## Summary\nFinal brief", provider: "fallback", confidenceScore: 0.9 } });
      }}
    >
      Generate brief
    </button>
  ),
}));

jest.mock("@/components/sre/incidents/edit-sre-incident-dialog", () => ({
  EditSreIncidentDialog: () => null,
}));

jest.mock("@/components/sre/incidents/resolve-sre-incident-dialog", () => ({
  OPEN_POSTMORTEM_EVENT: "incident:open-postmortem",
  ResolveSreIncidentDialog: ({ open }: { open?: boolean }) =>
    open ? <div role="dialog" aria-label="Resolve incident dialog" /> : null,
}));

jest.mock("@/components/sre/incidents/incident-assignee-picker", () => ({
  IncidentAssigneePicker: ({ label = "Assignee", assigneeName }: { label?: string; assigneeName: string | null }) => (
    <div>{label}: {assigneeName ?? "Unassigned"}</div>
  ),
}));

jest.mock("@/components/sre/incidents/acknowledge-sre-incident-button", () => ({
  AcknowledgeSreIncidentButton: () => <button type="button">Acknowledge</button>,
}));

jest.mock("@/components/sre/incidents/watch-sre-incident-button", () => ({
  WatchSreIncidentButton: ({ watching }: { watching: boolean }) => <button type="button">{watching ? "Unwatch" : "Watch"}</button>,
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
  SreInvestigationPanel: ({ hasPrimaryService }: { hasPrimaryService: boolean }) => (
    <div data-has-service={hasPrimaryService}>
      Mock AI investigation panel
      <button type="button">Run investigation</button>
    </div>
  ),
  SreReportSnapshotMenuItem: () => null,
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

const investigationTab = () => screen.getByRole("tabpanel", { name: "Investigation" });
// Radix tabs switch on mousedown.
const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

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
    // Internal ids and raw confidence are not shown.
    expect(screen.queryByText("Evidence ID")).not.toBeInTheDocument();
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

  it("shows the brief as the conclusion until an investigation exists, and hides generation from viewers", () => {
    const detail = detailFixture();
    detail.latestInvestigation = null;
    detail.incident.rootCauseSummary = null;
    detail.permissions.canInvestigate = false;
    detail.permissions.canUpdate = false;
    render(
      <SreIncidentDetailView
        detail={detail}
        services={[]}
        initialTab="brief"
      />,
    );
    const sheet = investigationTab();
    expect(within(sheet).getByRole("heading", { name: "Conclusion" })).toBeInTheDocument();
    expect(within(sheet).getByText("Brief summary")).toBeInTheDocument();
    // A brief is not rated.
    expect(within(sheet).queryByText(/^Confidence:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resolve incident" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Generate brief" }),
    ).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("shows the full brief, not its stored headline, before an investigation, and offers regeneration", () => {
    const detail = detailFixture();
    detail.latestInvestigation = null;
    detail.incident.rootCauseSummary = "Brief headline";
    detail.latestBrief!.agentStateSnapshot = { provider: "ai", summary: "## Summary\nFull brief body" };
    render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    const sheet = investigationTab();
    expect(within(sheet).getByText("Full brief body")).toBeInTheDocument();
    expect(within(sheet).queryByText("Brief headline")).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
  });

  it("streams a new brief into the conclusion, unrated, and puts the saved one back if it fails", () => {
    const detail = detailFixture();
    detail.latestInvestigation = null;
    detail.incident.rootCauseSummary = null;
    render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    const sheet = investigationTab();
    fireEvent.click(within(sheet).getByRole("button", { name: "Generate brief" }));
    expect(within(sheet).getByText("Final brief")).toBeInTheDocument();
    expect(within(sheet).getByText(/AI unavailable/)).toBeInTheDocument();
    expect(within(sheet).queryByText(/^Confidence:/)).not.toBeInTheDocument();
    briefStreamFails = true;
    fireEvent.click(within(sheet).getByRole("button", { name: "Generate brief" }));
    briefStreamFails = false;
    expect(within(sheet).getByText("Brief summary")).toBeInTheDocument();
    expect(within(sheet).queryByText("Partial")).not.toBeInTheDocument();
  });

  it("keeps an unsent Activity draft across tab switches", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    const timeline = screen.getByText("Mock timeline");
    openTab("Investigation");
    expect(timeline).toBeInTheDocument();
    expect(timeline).not.toBeVisible();
    openTab("Overview");
    expect(screen.getByText("Mock timeline")).toBe(timeline);
  });

  it("prefers the brief over triage before an investigation, and offers a brief beside a triage conclusion", () => {
    const detail = detailFixture();
    detail.latestInvestigation = null;
    detail.incident.rootCauseSummary = "Brief headline";
    detail.triageSummary = "Triage: connection pool exhausted";
    const withBrief = render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    expect(within(investigationTab()).getByText("Brief summary")).toBeInTheDocument();
    expect(within(investigationTab()).queryByText("Triage: connection pool exhausted")).not.toBeInTheDocument();
    withBrief.unmount();
    detail.latestBrief = null;
    detail.incident.rootCauseSummary = null;
    render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    expect(within(investigationTab()).getByText("Triage: connection pool exhausted")).toBeInTheDocument();
    expect(within(investigationTab()).getByText(/From AI triage/)).toBeInTheDocument();
    expect(within(investigationTab()).getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
  });

  it("shows one running status line and a conclusion placeholder while a first run is in progress", () => {
    const detail = detailFixture();
    detail.incident.rootCauseSummary = null;
    detail.latestBrief = null;
    detail.latestInvestigation = {
      ...detail.latestInvestigation!,
      status: "running",
      summary: null,
      steps: [{ index: 0, tool: "listNativeEvidence", args: "", status: "ok", resultCount: 1, durationMs: 5 }],
    };
    render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    const sheet = investigationTab();
    expect(within(sheet).getByText("Investigating: 1 check done")).toBeInTheDocument();
    expect(within(sheet).getByRole("status", { name: "Investigation in progress" })).toBeInTheDocument();
    expect(within(sheet).queryByText(/Last run/)).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/^Confidence:/)).not.toBeInTheDocument();
  });

  it("shows three next steps and the rest on request, with the outcome shown once", () => {
    const detail = detailFixture();
    detail.latestInvestigation = {
      ...detail.latestInvestigation!,
      structured: {
        outcome: "inconclusive", confidence: 0, conclusion: "No cause found.",
        nextChecks: ["Step one", "Step two", "Step three", "Step four"], topEvidenceIds: [], downgraded: false,
      },
    };
    render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    const sheet = investigationTab();
    expect(within(sheet).getByText("Inconclusive")).toBeInTheDocument();
    expect(within(sheet).queryByText(/No root cause established/)).not.toBeInTheDocument();
    expect(within(sheet).queryByText("Step four")).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Show all 4 steps" }));
    expect(within(sheet).getByText("Step four")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Show fewer" }));
    expect(within(sheet).queryByText("Step four")).not.toBeInTheDocument();
  });

  it("does not rate a failed run's earlier conclusion and still offers a brief", () => {
    const detail = detailFixture();
    detail.latestInvestigation = { ...detail.latestInvestigation!, status: "failed", summary: "Timed out." };
    render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    const sheet = investigationTab();
    expect(within(sheet).getByText("Previous conclusion")).toBeInTheDocument();
    expect(within(sheet).queryByText(/^Confidence:/)).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
  });

  it("shows the triage finding as the Investigation conclusion when no investigation or root cause exists", () => {
    const detail = detailFixture();
    detail.latestInvestigation = null;
    detail.latestBrief = null;
    detail.incident.rootCauseSummary = null;
    detail.triageSummary = "Triage: connection pool exhausted";
    render(<SreIncidentDetailView detail={detail} services={[]} initialTab="investigation" />);
    expect(within(investigationTab()).getByText("Triage: connection pool exhausted")).toBeInTheDocument();
  });

  it("keeps the brief and its generation out of the way once an investigation exists", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} initialTab="brief" />);
    const sheet = investigationTab();
    expect(within(sheet).queryByText("Brief summary")).not.toBeInTheDocument();
    expect(within(sheet).getByText("Latency correlates with monitor failures.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();
  });

  it("opens on Overview with Overview and Investigation tabs, status and severity shown once in the header", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview", "Investigation"]);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#42");
    expect(screen.getAllByText("Investigating")).toHaveLength(1);
    expect(screen.getAllByText("sev2")).toHaveLength(1);
    expect(screen.getByText("Checkout monitor down")).toBeInTheDocument();
    // Similar incidents sit in the right-hand column on every tab.
    expect(screen.getByRole("complementary", { name: "Incident details" })).toContainElement(screen.getByTestId("similar-incidents"));
    fireEvent.click(screen.getByRole("button", { name: "View investigation" }));
    expect(screen.getByRole("tab", { name: "Investigation" })).toHaveAttribute("aria-selected", "true");
    expect(within(investigationTab()).getByText("Mock AI investigation panel")).toBeInTheDocument();
  });

  it("writes the open tab to the URL and drops it again for Overview", () => {
    window.history.replaceState(null, "", "/incidents/42?edit=service");
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    openTab("Investigation");
    expect(window.location.search).toBe("?edit=service&tab=investigation");
    openTab("Overview");
    expect(window.location.search).toBe("?edit=service");
    window.history.replaceState(null, "", "/");
  });

  it.each([
    ["investigation", "Mock AI investigation panel"],
    ["evidence", "Monitor timeout"],
    ["brief", "Conclusion"],
  ] as const)("opens the Investigation tab for ?tab=%s", (tab, text) => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} initialTab={tab} />);
    expect(investigationTab()).toHaveTextContent(text);
  });

  it("opens the Investigation tab and scrolls to the item on #sre-evidence-<id> anchors", () => {
    const scroll = jest.fn();
    Element.prototype.scrollIntoView = scroll;
    window.location.hash = "#sre-evidence-ev-monitor-timeout";
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    const row = document.getElementById("sre-evidence-ev-monitor-timeout");
    expect(investigationTab()).toContainElement(row);
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    window.location.hash = "";
  });

  it("shows one report on the Investigation tab: conclusion and evidence, with similar incidents beside it", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    openTab("Investigation");
    const sheet = investigationTab();
    expect(within(sheet).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Conclusion", "Evidence1"]);
    expect(sheet).not.toContainElement(screen.getByTestId("similar-incidents"));
    expect(sheet).toHaveTextContent("Mock AI investigation panel");
    expect(within(sheet).queryByRole("heading", { name: "Report snapshot" })).not.toBeInTheDocument();
  });

  it("shows hypotheses and the step trace on the Investigation tab, with one feedback control on the card", () => {
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
    expect(screen.getAllByRole("heading", { name: "Hypotheses 2" })).toHaveLength(1);
    expect(screen.getByTestId("investigation-step-trace")).toHaveAttribute("data-state", "closed");
    expect(within(investigationTab()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Conclusion",
      "Hypotheses2",
      "Evidence1",
    ]);
    // Whole-investigation feedback lives once, on the Overview card (kept mounted, hidden on other tabs).
    expect(screen.getByText("Feedback: this investigation")).not.toBeVisible();
    openTab("Overview");
    expect(screen.getAllByText("Feedback: this investigation")).toHaveLength(1);
    expect(screen.getByText("Feedback: this investigation")).toBeVisible();
  });

  it("offers the Post-mortem tab only once the incident is resolved", () => {
    const open = render(<SreIncidentDetailView detail={detailFixture()} services={[]} initialTab="postmortem" />);
    expect(screen.queryByRole("tab", { name: "Post-mortem" })).not.toBeInTheDocument();
    // A post-mortem link on an open incident falls back to the overview.
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    open.unmount();
    const detail = detailFixture();
    detail.incident.status = "resolved";
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    openTab("Post-mortem");
    expect(screen.getByText("Mock post-mortem")).toHaveAttribute("data-can-edit", "true");
  });

  it("switches to the Post-mortem tab when the resolve toast asks for it", () => {
    const detail = detailFixture();
    detail.incident.status = "resolved";
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    act(() => {
      window.dispatchEvent(new Event("incident:open-postmortem"));
    });
    expect(screen.getByRole("tab", { name: "Post-mortem" })).toHaveAttribute("aria-selected", "true");
    window.history.replaceState(null, "", "/");
  });

  it("leads with the AI summary, then the timeline, with ownership actions in the header", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    const summary = screen.getByTestId("incident-ai-summary");
    expect(summary).toHaveTextContent("Latency correlates with monitor failures.");
    expect(summary).toHaveTextContent("Confidence: Medium");
    expect(
      summary.compareDocumentPosition(screen.getByText("Mock timeline")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Assignee: Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Post update" })).toBeInTheDocument();
    // Back control matches the monitor and job detail pages.
    expect(screen.getByRole("link", { name: "Back to incidents" })).toHaveAttribute("href", "/incidents");
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

  it("shows the triage finding in the AI summary when no investigation exists", () => {
    const detail = detailFixture();
    detail.incident.rootCauseSummary = null;
    detail.incident.confidenceScore = null;
    detail.latestInvestigation = null;
    detail.triageSummary = "Triage: connection pool exhausted";
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    expect(screen.getByTestId("incident-ai-summary")).toHaveTextContent("connection pool exhausted");
    expect(screen.queryByText(/No AI analysis yet/)).not.toBeInTheDocument();
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

  it("gives editors Edit and Ask Copilot, with investigation reached from the card", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Edit incident" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Ask Copilot" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /investigation/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Resolve incident" })).toBeInTheDocument();
  });

  it("links Ask Copilot to the incident-scoped Copilot page", () => {
    const detail = detailFixture();
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Ask Copilot" })).toHaveAttribute("href", `/copilot?incident=${detail.incident.id}`);
  });

  it("adds a commander from the menu instead of a permanent sidebar link", () => {
    render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    expect(screen.queryByText("Commander: None")).not.toBeInTheDocument();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add commander" }));
    expect(screen.getByText(/^Commander:/)).toBeInTheDocument();
  });

  it("offers Run investigation on the AI summary card when nothing has run yet", () => {
    const detail = detailFixture();
    detail.latestInvestigation = null;
    detail.incident.rootCauseSummary = null;
    detail.triageSummary = null;
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    openMenu();
    expect(screen.queryByRole("menuitem", { name: /investigation/i })).not.toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    // The run starts from the card; no extra step through the Investigation tab.
    expect(within(screen.getByTestId("incident-ai-summary")).getByRole("button", { name: "Run investigation" })).toBeInTheDocument();
  });

  it("shows viewers no actions menu, since every item needs update or investigate access", () => {
    const detail = detailFixture();
    detail.permissions.canUpdate = false;
    detail.permissions.canInvestigate = false;
    render(<SreIncidentDetailView detail={detail} services={[]} />);
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("shows Acknowledge, then Resolve as the incident progresses", () => {
    const fresh = render(<SreIncidentDetailView detail={detailFixture()} services={[]} />);
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve incident" })).not.toBeInTheDocument();
    fresh.unmount();

    const acked = detailFixture();
    acked.incident.acknowledgedAt = new Date("2026-06-24T12:10:00Z");
    const ackedView = render(<SreIncidentDetailView detail={acked} services={[]} />);
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post-mortem" })).not.toBeInTheDocument();
    // The header button opens the same dialog the menu uses.
    expect(screen.queryByRole("dialog", { name: "Resolve incident dialog" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resolve incident" }));
    expect(screen.getByRole("dialog", { name: "Resolve incident dialog" })).toBeInTheDocument();
    ackedView.unmount();

    const resolved = detailFixture();
    resolved.incident.status = "resolved";
    render(<SreIncidentDetailView detail={resolved} services={[]} />);
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve incident" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post-mortem" })).not.toBeInTheDocument();
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

describe("defaultResolutionNote", () => {
  it("pre-fills one paragraph, not a whole stored report", () => {
    const report = "# Incident Investigation Report\n\n## Report Details\n- **Severity**: sev2\n\n## Executive Summary\nThe job failed twice.\n\n## What Changed\n- Evidence ID: 01a111b9-8fa5-7c48-875e-f9be4ff9ba9c";
    expect(defaultResolutionNote(null, report)).toBe("The job failed twice.");
  });

  it("leads with the recovery when the source recovered, then the AI root cause", () => {
    expect(defaultResolutionNote("2026-06-24T12:00:00Z", "Bad deploy")).toBe(
      "The checks that raised this incident recovered on Wed, 24 Jun 2026 12:00:00 GMT and are passing again.\n\nBad deploy",
    );
  });

  it("falls back to the root cause alone, or nothing", () => {
    expect(defaultResolutionNote(null, "Bad deploy")).toBe("Bad deploy");
    expect(defaultResolutionNote(undefined, null)).toBe("");
  });
});
