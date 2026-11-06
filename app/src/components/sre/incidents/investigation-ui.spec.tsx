import { fireEvent, render, screen } from "@testing-library/react";

const mockSimilar = jest.fn();
jest.mock("@/hooks/use-sre", () => ({ useSreSimilarIncidents: (...a: unknown[]) => mockSimilar(...a) }));

import { InvestigationStepTrace } from "./investigation-step-trace";
import { SimilarIncidentsCard } from "./similar-incidents-card";

describe("InvestigationStepTrace", () => {
  const steps = [
    { index: 0, tool: "listNativeEvidence", args: "limit=10", status: "ok" as const, resultCount: 2, durationMs: 120 },
    { index: 1, tool: "searchLiveConnectorEvidence", args: "query=up", status: "error" as const, resultCount: null, durationMs: 2400 },
  ];

  it("is collapsed when finished, summarises failures and hides timings and raw tool names", () => {
    render(<InvestigationStepTrace steps={steps} running={false} />);
    const details = screen.getByTestId("investigation-step-trace");
    expect(details).toHaveAttribute("data-state", "closed");
    expect(details).toHaveTextContent("How it was investigated");
    expect(details).toHaveTextContent("2 steps, 1 failed");
    fireEvent.click(screen.getByRole("button", { name: /How it was investigated/ }));
    expect(details).toHaveTextContent("list native evidence");
    expect(details).toHaveTextContent("2 results");
    expect(details).not.toHaveTextContent("120 ms");
    expect(details).not.toHaveTextContent("listNativeEvidence");
    expect(screen.getByText("Failed:")).toHaveClass("sr-only");
  });

  it("is open and live while running, even before the first step", () => {
    render(<InvestigationStepTrace steps={[]} running />);
    expect(screen.getByTestId("investigation-step-trace")).toHaveAttribute("data-state", "open");
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText(/Steps appear here/)).toBeInTheDocument();
  });

  it("renders nothing for an old run without a trace", () => {
    const { container } = render(<InvestigationStepTrace steps={[]} running={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SimilarIncidentsCard", () => {
  const ok = (incidents: unknown[]) =>
    mockSimilar.mockReturnValue({ isPending: false, data: { success: true, incidents } });
  const incident = (n: number) => ({
    id: `i-${n}`, incidentNumber: n, title: `Past ${n}`, severity: "sev2", serviceName: "checkout",
    resolvedAt: new Date(), rootCauseSummary: "Bad deploy", resolutionSummary: n === 2 ? "Rolled back" : null, matchedOn: ["service", "title"],
  });

  it("renders nothing while loading, when unavailable or when there are no matches", () => {
    mockSimilar.mockReturnValue({ isPending: true, data: undefined });
    const { container, rerender } = render(<SimilarIncidentsCard incidentId="i-1" />);
    expect(mockSimilar).toHaveBeenCalledWith("i-1");
    expect(container).toBeEmptyDOMElement();
    mockSimilar.mockReturnValue({ isPending: false, data: { success: false, error: "x", incidents: [] } });
    rerender(<SimilarIncidentsCard incidentId="i-1" />);
    expect(container).toBeEmptyDOMElement();
    ok([]);
    rerender(<SimilarIncidentsCard incidentId="i-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links to past incidents with match reasons and how they were resolved, three at a time", () => {
    ok([2, 3, 4, 5].map(incident));
    render(<SimilarIncidentsCard incidentId="i-1" />);
    expect(screen.getByRole("heading", { name: "Similar incidents 4" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /#2 Past 2/ })).toHaveAttribute("href", "/incidents/i-2");
    expect(screen.getAllByText("Same service")).toHaveLength(3);
    expect(screen.getByText("Rolled back")).toBeInTheDocument();
    expect(screen.getAllByText("Bad deploy")).toHaveLength(2);
    expect(screen.queryByText("Past 5")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 4" }));
    expect(screen.getByText("Past 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("Past 5")).not.toBeInTheDocument();
  });
});
