import { fireEvent, render, screen } from "@testing-library/react";

import { SreEvidenceGraph } from "./evidence-graph";
import type { SreEvidenceGraph as SreEvidenceGraphData } from "@/lib/sre/evidence-graph-queries";

if (!globalThis.structuredClone) {
  globalThis.structuredClone = <T,>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}

if (!globalThis.ResizeObserver) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver =
    ResizeObserverMock as unknown as typeof ResizeObserver;
}

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

const graph: SreEvidenceGraphData = {
  nodes: [
    {
      id: "service:s1",
      sourceId: "s1",
      type: "service",
      title: "Checkout",
      subtitle: "prod",
      status: "active",
      href: "/org-admin?tab=services",
      createdAt: new Date("2026-06-24T10:00:00Z"),
    },
    {
      id: "monitor:m1",
      sourceId: "m1",
      type: "monitor",
      title: "Checkout monitor",
      subtitle: "http · https://checkout",
      status: "active",
      href: "/monitors",
      createdAt: new Date("2026-06-24T09:50:00Z"),
    },
    {
      id: "alert:a1",
      sourceId: "a1",
      type: "alert",
      title: "Checkout p95 breached",
      subtitle: "monitor",
      status: "sev2 · firing",
      href: null,
      createdAt: new Date("2026-06-24T10:04:00Z"),
    },
    {
      id: "incident:i1",
      sourceId: "i1",
      type: "incident",
      title: "#7 Checkout latency",
      subtitle: "sev2",
      status: "investigating",
      href: "/incidents/i1",
      createdAt: new Date("2026-06-24T10:05:00Z"),
    },
    {
      id: "evidence:e1",
      sourceId: "e1",
      type: "evidence",
      title: "Prometheus latency spike",
      subtitle: "prometheus · metric",
      status: "sev2",
      href: "/incidents/i1#sre-evidence-e1",
      createdAt: new Date("2026-06-24T10:10:00Z"),
    },
    {
      id: "investigation:r1",
      sourceId: "r1",
      type: "investigation",
      title: "Checkout investigation",
      subtitle: "gpt-4o-mini",
      status: "completed",
      href: null,
      createdAt: new Date("2026-06-24T10:14:00Z"),
    },
    {
      id: "playbook:p1",
      sourceId: "p1",
      type: "playbook",
      title: "Checkout latency playbook",
      subtitle: "1 matches",
      status: "active",
      href: null,
      createdAt: new Date("2026-06-24T10:20:00Z"),
    },
  ],
  edges: [
    {
      id: "service:s1->monitor:m1:monitored by",
      source: "service:s1",
      target: "monitor:m1",
      label: "monitored by",
      evidence: "Service resource mapping",
    },
    {
      id: "monitor:m1->alert:a1:triggered",
      source: "monitor:m1",
      target: "alert:a1",
      label: "triggered",
      evidence: "Alert source id",
    },
    {
      id: "alert:a1->incident:i1:triggered incident",
      source: "alert:a1",
      target: "incident:i1",
      label: "triggered incident",
      evidence: "Incident alert correlation",
    },
    {
      id: "service:s1->incident:i1:impacted service",
      source: "service:s1",
      target: "incident:i1",
      label: "impacted service",
      evidence: "Incident primary service scope",
    },
    {
      id: "incident:i1->evidence:e1:has evidence",
      source: "incident:i1",
      target: "evidence:e1",
      label: "has evidence",
      evidence: "prometheus",
    },
    {
      id: "incident:i1->investigation:r1:investigated by",
      source: "incident:i1",
      target: "investigation:r1",
      label: "investigated by",
      evidence: "Investigation run",
    },
    {
      id: "alert:a1->playbook:p1:matches playbook",
      source: "alert:a1",
      target: "playbook:p1",
      label: "matches playbook",
      evidence:
        "Alert fingerprint matched promoted playbook signature (service: checkout; severity: sev2; error pattern: p95 latency; hash abc123def456)",
    },
  ],
  stats: {
    service: 1,
    monitor: 1,
    job: 0,
    alert: 1,
    incident: 1,
    investigation: 1,
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
    expect(screen.queryByText("Prometheus latency spike")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search topology..."), {
      target: { value: "prometheus" },
    });

    expect(screen.queryByLabelText("Service: Checkout")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("Prometheus latency spike").length,
    ).toBeGreaterThan(0);
  });

  it("shows selected node relationships", () => {
    render(<SreEvidenceGraph graph={graph} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Incident: Checkout latency"));

    const detailsDialog = screen.getByRole("dialog", {
      name: /incident: checkout latency/i,
    });
    expect(detailsDialog).toBeInTheDocument();
    expect(detailsDialog).toHaveClass("max-h-[calc(100svh-1rem)]");
    expect(detailsDialog).not.toHaveClass(
      "h-[min(720px,calc(100svh-2rem))]",
    );
    expect(screen.getAllByText("#7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("impacted service").length).toBeGreaterThan(0);
    expect(screen.getAllByText("triggered incident").length).toBeGreaterThan(0);
    expect(screen.getAllByText("has evidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("investigated by").length).toBeGreaterThan(0);
  });

  it("does not render unsafe node detail links", () => {
    const graphWithUnsafeLink = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === "incident:i1"
          ? { ...node, href: "javascript:alert(1)" }
          : node,
      ),
    };

    render(<SreEvidenceGraph graph={graphWithUnsafeLink} />);
    fireEvent.click(screen.getByLabelText("Incident: Checkout latency"));

    expect(
      screen.queryByRole("link", { name: /view details/i }),
    ).not.toBeInTheDocument();
  });

  it("groups repeated relationships and provides a fallback title", () => {
    const graphWithDuplicates = structuredClone(graph);
    graphWithDuplicates.nodes.push(
      {
        id: "investigation:r2",
        sourceId: "r2",
        type: "investigation",
        title: "",
        subtitle: null,
        status: "completed",
        href: "/incidents/i1",
        createdAt: new Date("2026-06-24T10:15:00Z"),
      },
      {
        id: "investigation:r3",
        sourceId: "r3",
        type: "investigation",
        title: "",
        subtitle: null,
        status: "completed",
        href: "/incidents/i1",
        createdAt: new Date("2026-06-24T10:16:00Z"),
      },
    );
    graphWithDuplicates.edges.push(
      {
        id: "incident:i1->investigation:r2:investigated by",
        source: "incident:i1",
        target: "investigation:r2",
        label: "investigated by",
        evidence: "Investigation run",
      },
      {
        id: "incident:i1->investigation:r3:investigated by",
        source: "incident:i1",
        target: "investigation:r3",
        label: "investigated by",
        evidence: "Investigation run",
      },
    );

    render(<SreEvidenceGraph graph={graphWithDuplicates} />);
    fireEvent.click(screen.getByLabelText("Incident: Checkout latency"));

    expect(screen.getByText("investigation record")).toBeInTheDocument();
    expect(screen.getByText("2 similar")).toBeInTheDocument();
  });

  it("does not expose model names in investigation graph cards", () => {
    render(<SreEvidenceGraph graph={graph} />);

    expect(screen.getByText("Checkout investigation")).toBeInTheDocument();
    expect(screen.getAllByText("completed").length).toBeGreaterThan(0);
    expect(screen.queryByText("gpt-4o-mini")).not.toBeInTheDocument();
  });

  it("keeps secondary operational nodes out of the default view", () => {
    render(<SreEvidenceGraph graph={graph} />);

    expect(screen.queryByLabelText("Monitor: Checkout monitor")).not.toBeInTheDocument();
    expect(screen.getAllByText("Checkout p95 breached").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText("Checkout latency playbook").length,
    ).toBeGreaterThan(0);
  });

  it("explains why an alert matched a playbook", () => {
    render(<SreEvidenceGraph graph={graph} />);

    fireEvent.click(
      screen.getByLabelText("Playbook: Checkout latency playbook"),
    );

    expect(screen.getAllByText("matches playbook").length).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole("button", {
        name: /checkout p95 breached matches playbook/i,
      }),
    );
    expect(
      screen.getByText(
        /service: checkout; severity: sev2; error pattern: p95 latency/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders production topology navigation controls", () => {
    render(<SreEvidenceGraph graph={graph} />);

    expect(screen.getByText("Investigation context")).toBeInTheDocument();
    expect(
      screen.getByText(/select a node or relationship/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Investigation Map canvas"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /zoom in/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fit view/i })).toBeInTheDocument();
  });

  it("opens and closes the expanded topology view", () => {
    render(<SreEvidenceGraph graph={graph} />);

    fireEvent.click(
      screen.getByRole("button", { name: /expand investigation map/i }),
    );

    expect(
      screen.getByRole("dialog", { name: /expanded investigation map/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByLabelText("Investigation Map canvas"),
    ).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: /close expanded investigation map/i }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears active filters without exposing saved view controls", () => {
    render(<SreEvidenceGraph graph={graph} />);

    const searchInput = screen.getByPlaceholderText("Search topology...");
    fireEvent.change(searchInput, { target: { value: "prometheus" } });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(searchInput).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: /save local/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save shared/i }),
    ).not.toBeInTheDocument();
  });
});
