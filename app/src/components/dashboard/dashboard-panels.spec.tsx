import { fireEvent, render, screen } from "@testing-library/react";
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
  const openIncidents = { available: true as const, incidents: [incident("sev1"), incident("sev2")] };

  it("shows open incidents first, then failed runs on the Runs tab", () => {
    render(<NeedsAttentionCard failedRuns={failedRuns} incidentsResult={openIncidents} incidentsLoading={false} />);
    expect(screen.getByTestId("panel-open-incidents")).toBeTruthy();
    expect(screen.getByText("2 open incidents by severity")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All incidents" }).getAttribute("href")).toBe("/incidents");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Runs" }));
    expect(screen.getByTestId("panel-recent-failures")).toBeTruthy();
    expect(screen.getByText("3 failed runs by trigger, last 7 days")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All runs" }).getAttribute("href")).toBe("/runs");
  });

  it("omits the incidents tab when the incidents API is unavailable", () => {
    render(<NeedsAttentionCard failedRuns={failedRuns} incidentsResult={{ available: false }} incidentsLoading={false} />);
    expect(screen.queryByRole("tab", { name: "Incidents" })).toBeNull();
    expect(screen.getByTestId("panel-recent-failures")).toBeTruthy();
  });

  it("shows empty messages when nothing needs attention", () => {
    render(<NeedsAttentionCard failedRuns={{ manual: 0, scheduled: 0, remote: 0 }} incidentsResult={{ available: true, incidents: [] }} incidentsLoading={false} />);
    expect(screen.getByText("No failed runs in the last 7 days")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Incidents" }));
    expect(screen.getByText("No open incidents")).toBeTruthy();
  });

  it("hides the incident total while loading", () => {
    render(<NeedsAttentionCard failedRuns={failedRuns} incidentsResult={undefined} incidentsLoading />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Incidents" }));
    expect(screen.getByText("Open incidents by severity")).toBeTruthy();
    expect(screen.getByTestId("panel-open-incidents").textContent).not.toMatch(/\d/);
  });
});
