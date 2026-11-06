import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/actions/sre-incident-lifecycle", () => ({ addSreIncidentUpdate: jest.fn() }));
// The timeline import would otherwise load the auth stack, which needs structuredClone.
jest.mock("@/actions/sre-status-update-draft", () => ({ draftSreStatusUpdate: jest.fn() }));
jest.mock("@/hooks/use-sre", () => ({ useSreIncidentTimeline: jest.fn() }));

import type { SreIncidentDetail } from "@/actions/sre-incidents";

import { IncidentAiSummaryCard, confidenceLabel, rootCauseFromBrief, stripReportBoilerplate } from "./incident-ai-summary-card";
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

describe("stripReportBoilerplate", () => {
  it("drops the title and Overview fields the page header already shows", () => {
    const report = [
      "### Incident Investigation Report",
      "**Overview**",
      "**Incident Title:** Checkout: Job Failed",
      "**Severity:** Sev2",
      "**Status:** Investigating",
      "**Primary Service:** Unknown",
      "---",
      "**What Changed**",
      "- The job failed twice.",
    ].join("\n");
    expect(stripReportBoilerplate(report)).toBe("**What Changed**\n- The job failed twice.");
  });

  it("keeps field-style lines and Overview sections that appear after the header", () => {
    const report = [
      "# Incident Investigation Report",
      "**Severity:** Sev2",
      "**What Changed**",
      "- **Status:** Replica lag 40s, connections exhausted",
      "## Overview",
      "Checkout returned 500s for 12 minutes.",
    ].join("\n");
    expect(stripReportBoilerplate(report)).toBe(report.split("\n").slice(2).join("\n"));
  });

  it("keeps a leading field line that carries the finding when no report title precedes it", () => {
    const text = "**Status:** All replicas unhealthy\nThe outage continues.";
    expect(stripReportBoilerplate(text)).toBe(text);
  });

  it("keeps ordinary prose that mentions status or severity", () => {
    expect(stripReportBoilerplate("The status page stayed green while severity rose.")).toBe(
      "The status page stayed green while severity rose.",
    );
  });
});

describe("IncidentAiSummaryCard", () => {
  it("renders the conclusion with a confidence label", () => {
    render(<IncidentAiSummaryCard rootCauseSummary="Bad deploy" confidenceScore="0.8000" investigationStatus="completed" />);
    expect(screen.getByText("Bad deploy")).toBeInTheDocument();
    expect(screen.getByText("Confidence: High")).toBeInTheDocument();
  });

  it("never invents a conclusion when there is none", () => {
    render(<IncidentAiSummaryCard rootCauseSummary={null} confidenceScore="0.9" investigationStatus={null} />);
    expect(screen.getByText(/No AI analysis yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument();
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
  it("leads with the conclusion and the first next step", () => {
    render(
      <IncidentAiSummaryCard
        rootCauseSummary="Deploy 42 caused it."
        confidenceScore="0.8200"
        investigationStatus="completed"
        investigation={investigation({
          structured: {
            outcome: "identified", confidence: 0.82, conclusion: "Deploy 42 caused it.", nextChecks: ["Compare p95 before and after"],
            topEvidenceIds: evidence.map((e) => e.id).concat("missing-id"), downgraded: false,
          },
        })}
      />,
    );
    expect(screen.getByText("Confidence: High")).toBeInTheDocument();
    expect(screen.getByText("Compare p95 before and after")).toBeInTheDocument();
    expect(screen.getByText(/Next step/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^View evidence:/ })).not.toBeInTheDocument();
  });

  it("shows Inconclusive as a first-class outcome ", () => {
    render(
      <IncidentAiSummaryCard
        rootCauseSummary="The evidence does not establish a cause."
        confidenceScore="0.0000"
        investigationStatus="completed"
        investigation={investigation({
          structured: { outcome: "inconclusive", confidence: 0, conclusion: "The evidence does not establish a cause.", nextChecks: [], topEvidenceIds: [], downgraded: true },
        })}
      />,
    );
    expect(screen.getByText("Inconclusive")).toBeInTheDocument();
    // The badge says it once; no second "No root cause established" label.
    expect(screen.queryByText("No root cause established")).not.toBeInTheDocument();
    expect(screen.getByText(/did not support it/)).toBeInTheDocument();
    expect(screen.queryByText(/^Confidence:/)).not.toBeInTheDocument();
  });

  it("degrades to the plain report with no rating when structured output is missing", () => {
    render(
      <IncidentAiSummaryCard
        rootCauseSummary="Plain report"
        confidenceScore={null}
        investigationStatus="completed"
        investigation={investigation({ summary: "Plain report" })}
      />,
    );
    expect(screen.getAllByText("Plain report").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Inconclusive|Confidence/)).not.toBeInTheDocument();
  });

  it("shows live progress while running and the failure reason when a run fails", () => {
    const steps = [{ index: 0, tool: "t", args: "", status: "ok" as const, resultCount: 1, durationMs: 5 }];
    const { rerender } = render(
      <IncidentAiSummaryCard rootCauseSummary={null} confidenceScore={null} investigationStatus="running" investigation={investigation({ status: "running", steps })} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 check done so far");
    rerender(
      <IncidentAiSummaryCard rootCauseSummary="Old" confidenceScore="0.6" investigationStatus="running" investigation={investigation({ status: "running" })} />,
    );
    expect(screen.getByText("Previous conclusion")).toBeInTheDocument();
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

describe("rootCauseFromBrief", () => {
  const base = { incident: { rootCauseSummary: "The job failed." }, latestBrief: null, latestInvestigation: null } as never;
  it("is the brief before any investigation, and after one only when the stored text matches the brief", () => {
    expect(rootCauseFromBrief(base)).toBe(true);
    const withRun = { ...(base as object), latestInvestigation: { status: "failed" } } as never;
    expect(rootCauseFromBrief(withRun)).toBe(false);
    const matching = { ...(withRun as object), latestBrief: { agentStateSnapshot: { summary: "## Summary\nThe job failed.\n\n## Impact\nUnknown." } } } as never;
    expect(rootCauseFromBrief(matching)).toBe(true);
    expect(rootCauseFromBrief({ ...(base as object), incident: { rootCauseSummary: null } } as never)).toBe(false);
  });
});

describe("IncidentAiSummaryCard confidence", () => {
  it("rates from the run's own score when the incident row has none yet", () => {
    render(
      <IncidentAiSummaryCard
        rootCauseSummary="Deploy 42."
        confidenceScore={null}
        investigationStatus="completed"
        investigation={investigation({
          structured: { outcome: "identified", confidence: 0.8, conclusion: "Deploy 42.", nextChecks: [], topEvidenceIds: [], downgraded: false },
        })}
      />,
    );
    expect(screen.getByText("Confidence: High")).toBeInTheDocument();
  });
});

describe("describeTimelineEvent", () => {
  it("labels assignment, acknowledgement, resolution and comments", () => {
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "assigned" } }).title).toBe("Assignment changed");
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "acknowledged" } }).title).toBe("Acknowledged");
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "resolved", comment: "fixed" } })).toEqual({ title: "Resolved", body: "fixed" });
    expect(describeTimelineEvent({ eventType: "comment", eventData: { text: "hi" } })).toEqual({ title: "Note", body: "hi" });
    expect(describeTimelineEvent({ eventType: "ai_finding", eventData: { summary: "Cause" } }).body).toBe("Cause");
    expect(describeTimelineEvent({ eventType: "tool_call", eventData: null })).toEqual({ title: "tool call", body: null });
  });
});

describe("IncidentAiSummaryCard compact layout", () => {
  it("shows one plain paragraph of a stored report, with no Show more, and links to the Investigation tab", () => {
    const onOpenInvestigation = jest.fn();
    const report = "# Incident Investigation Report\n\n## Report Details\n- **Severity**: sev2\n\n## Executive Summary\nThe **job** failed twice.\n\n## What Changed\n- Evidence ID: 01a111b9-8fa5-7c48-875e-f9be4ff9ba9c";
    render(
      <IncidentAiSummaryCard
        rootCauseSummary={report}
        confidenceScore="0.6"
        investigationStatus="completed"
        onOpenInvestigation={onOpenInvestigation}
        feedback={<span>Was this right?</span>}
      />,
    );
    expect(screen.getByTestId("ai-summary-body")).toHaveTextContent(/^The job failed twice\.$/);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View investigation" }));
    expect(onOpenInvestigation).toHaveBeenCalled();
    expect(screen.getByText("Was this right?")).toBeInTheDocument();
  });

  it("keeps a summary that is nothing but header lines rather than showing it as empty", () => {
    render(<IncidentAiSummaryCard rootCauseSummary="**Status:** Investigating" confidenceScore="0.8" investigationStatus="completed" />);
    expect(screen.queryByText(/No AI analysis yet/)).toBeNull();
    expect(screen.getByText(/Investigating/)).toBeInTheDocument();
  });

  it.each([
    ["brief", "From the evidence brief"],
    ["triage", "From AI triage"],
  ] as const)("names a %s summary and gives it no confidence rating", (source, label) => {
    render(<IncidentAiSummaryCard rootCauseSummary="Pool exhausted" confidenceScore="0.9" investigationStatus={null} source={source} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument();
  });

  it("does not rate a failed run's previous conclusion", () => {
    render(<IncidentAiSummaryCard rootCauseSummary="Earlier" confidenceScore="0.9" investigationStatus="failed" />);
    expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument();
  });

  it("puts the run controls in the empty state", () => {
    render(
      <IncidentAiSummaryCard rootCauseSummary={null} confidenceScore={null} investigationStatus={null} runControls={<button type="button">Run investigation</button>} />,
    );
    expect(screen.getByText("No AI analysis yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run investigation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View investigation" })).toBeNull();
  });
});
