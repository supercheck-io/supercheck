import { fireEvent, render, screen } from "@testing-library/react";

import { SreEvidenceGraph } from "./evidence-graph";
import type { SreEvidenceGraph as SreEvidenceGraphData } from "@/lib/sre/evidence-graph-queries";

const graph: SreEvidenceGraphData = {
  nodes: [
    { id: "service:s1", sourceId: "s1", type: "service", title: "Checkout", subtitle: "prod", status: "active", href: "/services", createdAt: new Date("2026-06-24T10:00:00Z") },
    { id: "incident:i1", sourceId: "i1", type: "incident", title: "#7 Checkout latency", subtitle: "sev2", status: "investigating", href: "/incidents/i1", createdAt: new Date("2026-06-24T10:05:00Z") },
    { id: "evidence:e1", sourceId: "e1", type: "evidence", title: "Prometheus latency spike", subtitle: "prometheus · metric", status: "sev2", href: "/incidents/i1#sre-evidence-e1", createdAt: new Date("2026-06-24T10:10:00Z") },
  ],
  edges: [
    { id: "service:s1->incident:i1:impacted service", source: "service:s1", target: "incident:i1", label: "impacted service", evidence: "Incident primary service scope" },
    { id: "incident:i1->evidence:e1:has evidence", source: "incident:i1", target: "evidence:e1", label: "has evidence", evidence: "prometheus" },
  ],
  stats: { service: 1, incident: 1, investigation: 0, evidence: 1, recommendation: 0 },
};

describe("SreEvidenceGraph", () => {
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
    expect(screen.getAllByText("has evidence").length).toBeGreaterThan(0);
  });
});
