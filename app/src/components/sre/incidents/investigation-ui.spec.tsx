import { render, screen } from "@testing-library/react";

import { InvestigationStepTrace } from "./investigation-step-trace";
import { SimilarIncidentsCard } from "./similar-incidents-card";

describe("InvestigationStepTrace", () => {
  const steps = [
    { index: 0, tool: "listNativeEvidence", args: "limit=10", status: "ok" as const, resultCount: 2, durationMs: 120 },
    { index: 1, tool: "searchLiveConnectorEvidence", args: "query=up", status: "error" as const, resultCount: null, durationMs: 2400 },
  ];

  it("is collapsed when finished and summarises failures", () => {
    render(<InvestigationStepTrace steps={steps} running={false} />);
    const details = screen.getByTestId("investigation-step-trace");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("2 steps, 1 failed");
    expect(details).toHaveTextContent("2 results · 120 ms");
    expect(details).toHaveTextContent("2.4 s");
    expect(screen.getByText("Failed:")).toHaveClass("sr-only");
  });

  it("is open and live while running, even before the first step", () => {
    render(<InvestigationStepTrace steps={[]} running />);
    expect(screen.getByTestId("investigation-step-trace")).toHaveAttribute("open");
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText(/Steps appear here/)).toBeInTheDocument();
  });

  it("renders nothing for an old run without a trace", () => {
    const { container } = render(<InvestigationStepTrace steps={[]} running={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SimilarIncidentsCard", () => {
  it("shows an empty state", () => {
    render(<SimilarIncidentsCard incidents={[]} />);
    expect(screen.getByText(/No similar resolved incidents in the last 180 days/)).toBeInTheDocument();
  });

  it("links to past incidents with match reasons and a may-be-unrelated caveat", () => {
    render(
      <SimilarIncidentsCard
        incidents={[
          {
            id: "i-2", incidentNumber: 7, title: "Checkout latency", severity: "sev2", serviceName: "checkout",
            resolvedAt: new Date(), rootCauseSummary: "Bad deploy", resolutionSummary: "Rolled back", matchedOn: ["service", "title"],
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "#7 Checkout latency" })).toHaveAttribute("href", "/incidents/i-2");
    expect(screen.getByText("Same service")).toBeInTheDocument();
    expect(screen.getByText("Rolled back")).toBeInTheDocument();
    expect(screen.getByText(/may be unrelated/)).toBeInTheDocument();
  });
});
