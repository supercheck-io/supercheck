import { render, screen } from "@testing-library/react";

const mockSimilar = jest.fn();
jest.mock("@/hooks/use-sre", () => ({ useSreSimilarIncidents: (...a: unknown[]) => mockSimilar(...a) }));

import { InvestigationStepTrace } from "./investigation-step-trace";
import { SimilarIncidentsList, useSimilarIncidentCount } from "./similar-incidents-card";

describe("InvestigationStepTrace", () => {
  const steps = [
    { index: 0, tool: "listNativeEvidence", args: "limit=10", status: "ok" as const, resultCount: 2, durationMs: 120 },
    { index: 1, tool: "searchLiveConnectorEvidence", args: "query=up", status: "error" as const, resultCount: null, durationMs: 2400 },
  ];

  it("stays open when finished and summarises failures", () => {
    render(<InvestigationStepTrace steps={steps} running={false} />);
    const details = screen.getByTestId("investigation-step-trace");
    expect(details).toHaveAttribute("open");
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

describe("SimilarIncidentsList", () => {
  const ok = (incidents: unknown[]) =>
    mockSimilar.mockReturnValue({ isPending: false, data: { success: true, incidents } });

  it("says so when loading, unavailable or empty", () => {
    mockSimilar.mockReturnValue({ isPending: true, data: undefined });
    const { rerender } = render(<SimilarIncidentsList incidentId="i-1" />);
    expect(mockSimilar).toHaveBeenCalledWith("i-1");
    expect(screen.getByText(/Looking for similar incidents/)).toBeInTheDocument();
    mockSimilar.mockReturnValue({ isPending: false, data: { success: false, error: "x", incidents: [] } });
    rerender(<SimilarIncidentsList incidentId="i-1" />);
    expect(screen.getByText(/unavailable right now/)).toBeInTheDocument();
    ok([]);
    rerender(<SimilarIncidentsList incidentId="i-1" />);
    expect(screen.getByText(/No similar resolved incidents/)).toBeInTheDocument();
  });

  it("links to past incidents with their service and match reasons", () => {
    ok([
      {
        id: "i-2", incidentNumber: 7, title: "Checkout latency", severity: "sev2", serviceName: "checkout",
        resolvedAt: new Date(), rootCauseSummary: "Bad deploy", resolutionSummary: "Rolled back", matchedOn: ["service", "title"],
      },
    ]);
    render(<SimilarIncidentsList incidentId="i-1" />);
    expect(screen.getByRole("link", { name: "#7 Checkout latency" })).toHaveAttribute("href", "/incidents/i-2");
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(screen.getByText("Same service")).toBeInTheDocument();
    expect(screen.getByText("Rolled back")).toBeInTheDocument();
  });
});

describe("useSimilarIncidentCount", () => {
  function Count() {
    const count = useSimilarIncidentCount("i-1");
    return <span>{count === null ? "none" : count}</span>;
  }

  it("is null until the list loads, then the number of matches", () => {
    mockSimilar.mockReturnValue({ isPending: true, data: undefined });
    const { rerender } = render(<Count />);
    expect(screen.getByText("none")).toBeInTheDocument();
    mockSimilar.mockReturnValue({ isPending: false, data: { success: true, incidents: [{}, {}] } });
    rerender(<Count />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
