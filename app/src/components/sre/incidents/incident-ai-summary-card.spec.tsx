import { render, screen } from "@testing-library/react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";

import { IncidentAiSummaryCard, confidenceLabel } from "./incident-ai-summary-card";
import { describeTimelineEvent } from "./incident-timeline";

describe("confidenceLabel", () => {
  it.each([
    ["0.9000", "High"],
    ["0.6000", "Medium"],
    ["0.2000", "Low"],
    ["0", "Inconclusive"],
    [null, "Inconclusive"],
    ["abc", "Inconclusive"],
  ])("maps %s to %s", (score, label) => {
    expect(confidenceLabel(score).label).toBe(label);
  });
});

describe("IncidentAiSummaryCard", () => {
  it("renders the conclusion with a confidence label", () => {
    render(<IncidentAiSummaryCard rootCauseSummary="Bad deploy" confidenceScore="0.8000" investigationStatus="completed" />);
    expect(screen.getByText("Bad deploy")).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
  });

  it("never invents a conclusion when there is none", () => {
    render(<IncidentAiSummaryCard rootCauseSummary={null} confidenceScore="0.9" investigationStatus={null} />);
    expect(screen.getByText(/No AI conclusion yet/)).toBeInTheDocument();
    expect(screen.queryByText(/confidence/)).not.toBeInTheDocument();
  });

  it("shows a running state", () => {
    render(<IncidentAiSummaryCard rootCauseSummary={null} confidenceScore={null} investigationStatus="running" />);
    expect(screen.getByText("Waiting for the first findings.")).toBeInTheDocument();
  });
});

const E1 = "018f0000-0000-7000-8000-0000000000e1";
const evidence = [1, 2, 3, 4].map((n) => ({
  id: `018f0000-0000-7000-8000-0000000000e${n}`,
  title: `Evidence ${n}`,
  summary: null,
  sourceUri: "https://example.com",
  evidenceType: "event",
  severity: null,
  confidence: null,
  rawContentExcerpt: null,
  citationQuery: null,
  observedAt: null,
  createdAt: new Date(),
})) as SreIncidentDetail["evidence"];

function investigation(overrides: Partial<NonNullable<SreIncidentDetail["latestInvestigation"]>> = {}) {
  return {
    id: "run-1", modelId: "m", status: "completed", summary: "s", completedAt: new Date(), createdAt: new Date(),
    structured: null, hypotheses: [], steps: [], myFeedback: [], ...overrides,
  } as NonNullable<SreIncidentDetail["latestInvestigation"]>;
}

describe("IncidentAiSummaryCard structured states", () => {
  it("leads with the conclusion and at most three evidence citations", () => {
    render(
      <IncidentAiSummaryCard
        rootCauseSummary="Deploy 42 caused it."
        confidenceScore="0.8200"
        investigationStatus="completed"
        incidentId="i1"
        evidence={evidence}
        investigation={investigation({
          structured: {
            outcome: "identified", confidence: 0.82, conclusion: "Deploy 42 caused it.", nextChecks: [],
            topEvidenceIds: evidence.map((e) => e.id).concat("missing-id"),
          },
        })}
      />,
    );
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^View evidence:/ })).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Investigation Map" })).toHaveAttribute("href", "/copilot/evidence-graph?incident=i1");
  });

  it("shows Inconclusive as a first-class outcome without citations", () => {
    render(
      <IncidentAiSummaryCard
        rootCauseSummary="The evidence does not establish a cause."
        confidenceScore="0.0000"
        investigationStatus="completed"
        evidence={evidence}
        investigation={investigation({
          structured: { outcome: "inconclusive", confidence: 0, conclusion: "The evidence does not establish a cause.", nextChecks: [], topEvidenceIds: [] },
        })}
      />,
    );
    expect(screen.getByText("Inconclusive")).toBeInTheDocument();
    expect(screen.getByText("No root cause established")).toBeInTheDocument();
    expect(screen.queryByText(/confidence$/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^View evidence:/ })).toHaveLength(0);
  });

  it("degrades to a summary-only card with no rating when structured output is missing", () => {
    render(
      <IncidentAiSummaryCard
        rootCauseSummary="Plain report"
        confidenceScore={null}
        investigationStatus="completed"
        investigation={investigation()}
      />,
    );
    expect(screen.getByText("Plain report")).toBeInTheDocument();
    expect(screen.queryByText(/Inconclusive|confidence/)).not.toBeInTheDocument();
    expect(screen.getByText(/Summary only/)).toBeInTheDocument();
  });

  it("shows live progress while running and the failure reason when a run fails", () => {
    const steps = [{ index: 0, tool: "t", args: "", status: "ok" as const, resultCount: 1, durationMs: 5 }];
    const { rerender } = render(
      <IncidentAiSummaryCard rootCauseSummary={null} confidenceScore={null} investigationStatus="running" investigation={investigation({ status: "running", steps })} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 check done so far");
    rerender(
      <IncidentAiSummaryCard
        rootCauseSummary="Earlier result" confidenceScore="0.6" investigationStatus="failed"
        investigation={investigation({ status: "failed", summary: "Investigation timed out." })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Investigation timed out.");
    expect(screen.getByText("Previous conclusion")).toBeInTheDocument();
  });
});

describe("describeTimelineEvent", () => {
  it("labels assignment, acknowledgement, resolution and comments", () => {
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "assigned" } }).title).toBe("Assignment changed");
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "acknowledged" } }).title).toBe("Acknowledged");
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "resolved", comment: "fixed" } })).toEqual({ title: "Resolved", body: "fixed" });
    expect(describeTimelineEvent({ eventType: "comment", eventData: { text: "hi" } })).toEqual({ title: "Update", body: "hi" });
    expect(describeTimelineEvent({ eventType: "ai_finding", eventData: { summary: "Cause" } }).body).toBe("Cause");
    expect(describeTimelineEvent({ eventType: "tool_call", eventData: null })).toEqual({ title: "tool call", body: null });
  });
});
