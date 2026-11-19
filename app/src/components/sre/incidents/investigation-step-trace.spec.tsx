import { fireEvent, render, screen } from "@testing-library/react";

import { inconclusiveReason } from "./inconclusive-hint";
import { InvestigationStepTrace, parseStepArgs, summarizeStepArgs } from "./investigation-step-trace";

const ARGS =
  'serviceId=[redacted], connectorId=[redacted], query=sum(rate(x{status=~"5.."}[5m])), namespace=default, timeWindowMinutes=60, maxRows=5, maxBytes=12000';

describe("investigation step trace", () => {
  it("keeps commas inside values and hides redacted ids and limits from the summary", () => {
    expect(parseStepArgs("query=a, b, c, window=5").map((pair) => pair.key)).toEqual(["query", "window"]);
    expect(parseStepArgs('query=x{service="a",status=~"5.."}, ns=default').map((pair) => pair.key)).toEqual(["query", "ns"]);
    expect(summarizeStepArgs(ARGS)).toBe('query: sum(rate(x{status=~"5.."}[5m])) · namespace: default · last 60 min');
  });

  it("expands a row to every argument and the full error", () => {
    render(
      <InvestigationStepTrace
        running
        steps={[{ index: 0, tool: "searchLiveConnectorEvidence", args: ARGS, status: "error", resultCount: null, durationMs: 5, error: "504 Gateway Timeout from loki" }]}
      />,
    );
    expect(screen.queryByText("[redacted]")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /search live connector evidence/ }));
    expect(screen.getByText("maxBytes")).toBeInTheDocument();
    expect(screen.getAllByText("504 Gateway Timeout from loki")).toHaveLength(2);
  });
});

describe("inconclusiveReason", () => {
  const base = {
    incident: { primaryServiceId: "svc" },
    latestInvestigation: { status: "completed", structured: { outcome: "inconclusive" }, steps: [] },
    capabilities: { hasValidConnector: true, investigationEnabled: true },
    evidence: [{}],
    permissions: { canUpdate: true },
  };
  const reason = (patch: object) => inconclusiveReason({ ...base, ...patch } as never, "/map");

  it("names the gap and the fix from stored data only", () => {
    expect(reason({ incident: { primaryServiceId: null } })).toEqual({ missing: expect.stringMatching(/No service is linked/), fix: { label: "Link a service", href: "/map" } });
    expect(reason({ capabilities: { hasValidConnector: false } })?.fix?.label).toBe("Add a connector");
    expect(
      reason({ latestInvestigation: { status: "failed", structured: null, steps: [{ status: "error" }, { status: "ok" }] } })?.missing,
    ).toBe("1 of 2 source searches failed, so those sources were not checked.");
    expect(reason({ permissions: { canUpdate: false }, incident: { primaryServiceId: null } })?.fix).toBeNull();
  });

  it("stays quiet for a run that concluded or is still running", () => {
    expect(reason({ latestInvestigation: { status: "completed", structured: { outcome: "identified" }, steps: [] } })).toBeNull();
    expect(reason({ latestInvestigation: { status: "running", structured: null, steps: [] } })).toBeNull();
  });
});
