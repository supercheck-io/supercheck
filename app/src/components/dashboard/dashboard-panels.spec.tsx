import { render, screen, within } from "@testing-library/react";
import { NeedsAttentionCard, failuresByTrigger, incidentsBySeverity } from "./dashboard-panels";

const failedRuns = { manual: 2, scheduled: 1, remote: 0 };
const incident = (severity: string) => ({
  id: severity, incidentNumber: 1, title: "t", severity, status: "investigating", primaryServiceName: null, updatedAt: "2026-01-01T00:00:00Z",
});

describe("chart data", () => {
  it("lists every trigger and severity, in order, with zero counts", () => {
    expect(failuresByTrigger(failedRuns).map((d) => [d.name, d.count])).toEqual([["Manual", 2], ["Scheduled", 1], ["API", 0]]);
    expect(incidentsBySeverity([incident("sev1"), incident("sev1"), incident("sev3"), incident("other")]).map((d) => d.count))
      .toEqual([2, 0, 1, 0]);
  });
});

describe("NeedsAttentionCard", () => {
  it("shows totals and links for failures and open incidents", () => {
    render(<NeedsAttentionCard failedRuns={failedRuns} incidentsResult={{ available: true, incidents: [incident("sev1"), incident("sev2")] }} incidentsLoading={false} />);
    const failures = screen.getByTestId("panel-recent-failures");
    expect(failures.textContent).toContain("3");
    expect(within(failures).getByRole("link", { name: "All runs" }).getAttribute("href")).toBe("/runs");
    const incidents = screen.getByTestId("panel-open-incidents");
    expect(incidents.textContent).toContain("2");
    expect(within(incidents).getByRole("link", { name: "All incidents" }).getAttribute("href")).toBe("/incidents");
  });

  it("omits the incidents section when the incidents API is unavailable", () => {
    render(<NeedsAttentionCard failedRuns={failedRuns} incidentsResult={{ available: false }} incidentsLoading={false} />);
    expect(screen.queryByTestId("panel-open-incidents")).toBeNull();
    expect(screen.getByTestId("panel-recent-failures")).toBeTruthy();
  });

  it("shows empty messages when nothing needs attention", () => {
    render(<NeedsAttentionCard failedRuns={{ manual: 0, scheduled: 0, remote: 0 }} incidentsResult={{ available: true, incidents: [] }} incidentsLoading={false} />);
    expect(screen.getByText("No failed runs in the last 7 days")).toBeTruthy();
    expect(screen.getByText("No open incidents")).toBeTruthy();
  });

  it("keeps the incidents section and hides its total while loading", () => {
    render(<NeedsAttentionCard failedRuns={failedRuns} incidentsResult={undefined} incidentsLoading />);
    const incidents = screen.getByTestId("panel-open-incidents");
    expect(incidents.textContent).not.toMatch(/\d/);
  });
});
