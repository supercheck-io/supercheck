import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SreEvidenceGraph } from "./evidence-graph";
import { saveSreEvidenceGraphFocusedView } from "@/actions/sre-evidence-graph-views";
import type { SreEvidenceGraph as SreEvidenceGraphData } from "@/lib/sre/evidence-graph-queries";

jest.mock("@/actions/sre-evidence-graph-views", () => ({
  archiveSreEvidenceGraphFocusedView: jest.fn(),
  saveSreEvidenceGraphFocusedView: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

const graph: SreEvidenceGraphData = {
  nodes: [
    { id: "service:s1", sourceId: "s1", type: "service", title: "Checkout", subtitle: "prod", status: "active", href: "/services", createdAt: new Date("2026-06-24T10:00:00Z") },
    { id: "monitor:m1", sourceId: "m1", type: "monitor", title: "Checkout monitor", subtitle: "http · https://checkout", status: "active", href: "/monitors", createdAt: new Date("2026-06-24T09:50:00Z") },
    { id: "alert:a1", sourceId: "a1", type: "alert", title: "Checkout p95 breached", subtitle: "monitor", status: "sev2 · firing", href: null, createdAt: new Date("2026-06-24T10:04:00Z") },
    { id: "incident:i1", sourceId: "i1", type: "incident", title: "#7 Checkout latency", subtitle: "sev2", status: "investigating", href: "/incidents/i1", createdAt: new Date("2026-06-24T10:05:00Z") },
    { id: "evidence:e1", sourceId: "e1", type: "evidence", title: "Prometheus latency spike", subtitle: "prometheus · metric", status: "sev2", href: "/incidents/i1#sre-evidence-e1", createdAt: new Date("2026-06-24T10:10:00Z") },
    { id: "playbook:p1", sourceId: "p1", type: "playbook", title: "Checkout latency playbook", subtitle: "1 matches", status: "active", href: null, createdAt: new Date("2026-06-24T10:20:00Z") },
  ],
  edges: [
    { id: "service:s1->monitor:m1:monitored by", source: "service:s1", target: "monitor:m1", label: "monitored by", evidence: "Service resource mapping" },
    { id: "monitor:m1->alert:a1:triggered", source: "monitor:m1", target: "alert:a1", label: "triggered", evidence: "Alert source id" },
    { id: "alert:a1->incident:i1:triggered incident", source: "alert:a1", target: "incident:i1", label: "triggered incident", evidence: "Incident alert correlation" },
    { id: "service:s1->incident:i1:impacted service", source: "service:s1", target: "incident:i1", label: "impacted service", evidence: "Incident primary service scope" },
    { id: "incident:i1->evidence:e1:has evidence", source: "incident:i1", target: "evidence:e1", label: "has evidence", evidence: "prometheus" },
    {
      id: "alert:a1->playbook:p1:matches playbook",
      source: "alert:a1",
      target: "playbook:p1",
      label: "matches playbook",
      evidence: "Alert fingerprint matched promoted playbook signature (service: checkout; severity: sev2; error pattern: p95 latency; hash abc123def456)",
    },
  ],
  stats: {
    service: 1,
    monitor: 1,
    job: 0,
    alert: 1,
    incident: 1,
    investigation: 0,
    evidence: 1,
    recommendation: 0,
    deployment: 0,
    commit: 0,
    recollection: 0,
    playbook: 1,
  },
};

describe("SreEvidenceGraph", () => {
  afterEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
  });

  it("renders nodes and filters by search", () => {
    render(<SreEvidenceGraph graph={graph} />);

    expect(screen.getAllByText("Checkout").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Prometheus latency spike").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText("Search graph nodes..."), { target: { value: "prometheus" } });

    expect(screen.queryByRole("button", { name: /select service node checkout/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("Prometheus latency spike").length).toBeGreaterThan(0);
  });

  it("shows selected node relationships", () => {
    render(<SreEvidenceGraph graph={graph} />);

    fireEvent.click(screen.getByRole("button", { name: /select incident node #7 checkout latency/i }));

    expect(screen.getAllByText("impacted service").length).toBeGreaterThan(0);
    expect(screen.getAllByText("triggered incident").length).toBeGreaterThan(0);
    expect(screen.getAllByText("has evidence").length).toBeGreaterThan(0);
  });

  it("renders expanded operational node types", () => {
    render(<SreEvidenceGraph graph={graph} />);

    expect(screen.getAllByText("Checkout monitor").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Checkout p95 breached").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Checkout latency playbook").length).toBeGreaterThan(0);
  });

  it("explains why an alert matched a playbook", () => {
    render(<SreEvidenceGraph graph={graph} />);

    fireEvent.click(screen.getByRole("button", { name: /select playbook node checkout latency playbook/i }));

    expect(screen.getAllByText("matches playbook").length).toBeGreaterThan(0);
    expect(screen.getByText(/service: checkout; severity: sev2; error pattern: p95 latency/i)).toBeInTheDocument();
  });

  it("keeps the graph controls focused on filtering and node selection", () => {
    render(<SreEvidenceGraph graph={graph} />);

    expect(screen.getByText("Operational lanes")).toBeInTheDocument();
    expect(screen.getByText(/filter by incident or node type/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /zoom in graph/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fit/i })).not.toBeInTheDocument();
  });

  it("saves and reapplies focused graph views in browser storage", () => {
    render(<SreEvidenceGraph graph={graph} />);

    const searchInput = screen.getByPlaceholderText("Search graph nodes...");
    fireEvent.change(searchInput, { target: { value: "prometheus" } });
    fireEvent.click(screen.getByRole("button", { name: /save local/i }));

    const savedViewButton = screen.getByText('All incidents · all nodes · "prometheus"').closest("button");
    expect(savedViewButton).not.toBeNull();
    expect(window.localStorage.getItem("supercheck:sre:evidence-graph:focused-views:v1")).toContain("prometheus");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(searchInput).toHaveValue("");

    fireEvent.click(savedViewButton!);
    expect(searchInput).toHaveValue("prometheus");
  });

  it("saves and reapplies shared graph views", async () => {
    jest.mocked(saveSreEvidenceGraphFocusedView).mockResolvedValue({
      success: true,
      view: {
        id: "7fc2b527-890e-4b33-8b5f-1e4d7f5e7c8d",
        name: 'All incidents · all nodes · "prometheus"',
        query: "prometheus",
        nodeType: "all",
        incidentId: "all",
        createdByUserId: "user-1",
        createdAt: "2026-06-29T10:00:00.000Z",
        updatedAt: "2026-06-29T10:00:00.000Z",
      },
    });
    render(<SreEvidenceGraph graph={graph} />);

    const searchInput = screen.getByPlaceholderText("Search graph nodes...");
    fireEvent.change(searchInput, { target: { value: "prometheus" } });
    fireEvent.click(screen.getByRole("button", { name: /save shared/i }));

    await waitFor(() => {
      expect(saveSreEvidenceGraphFocusedView).toHaveBeenCalledWith({
        name: 'All incidents · all nodes · "prometheus"',
        query: "prometheus",
        nodeType: "all",
        incidentId: "all",
      });
    });

    expect(await screen.findByText('All incidents · all nodes · "prometheus"')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(searchInput).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: 'All incidents · all nodes · "prometheus"' }));
    expect(searchInput).toHaveValue("prometheus");
  });
});
