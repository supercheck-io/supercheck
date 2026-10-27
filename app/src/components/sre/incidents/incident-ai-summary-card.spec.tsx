import { render, screen } from "@testing-library/react";

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
