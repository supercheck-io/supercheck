import { fireEvent, render, screen } from "@testing-library/react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";

import { IncidentSidebar } from "./incident-sidebar";

jest.mock("@/components/sre/incidents/incident-assignee-picker", () => ({
  IncidentAssigneePicker: ({ label, assigneeName }: { label: string; assigneeName: string | null }) => (
    <div data-testid={`picker-${label}`}>{label}: {assigneeName ?? "Unassigned"}</div>
  ),
}));

jest.mock("@/components/sre/incidents/watch-sre-incident-button", () => ({
  WatchSreIncidentButton: ({ watching }: { watching: boolean }) => <button type="button">{watching ? "Unwatch" : "Watch"}</button>,
}));

const now = new Date("2026-06-24T12:00:00Z");
function detailFixture(): SreIncidentDetail {
  return {
    incident: {
      id: "inc-1", status: "investigating", acknowledgedAt: null, acknowledgedByName: null, createdAt: now, resolvedAt: null,
      assigneeUserId: null, assigneeName: null, assigneeImage: null,
      commanderUserId: null, commanderName: null, commanderImage: null,
      primaryServiceId: null, primaryServiceName: null,
    },
    linkedAlerts: [],
    publicIncident: null,
    permissions: { canUpdate: true, canInvestigate: true, canUseLiveConnectors: true },
  } as unknown as SreIncidentDetail;
}
const alerts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i}`, title: `Alert ${i}`, status: "firing", severity: "sev2", role: "trigger", firedAt: now }));


describe("IncidentSidebar", () => {
  it("shows the commander picker only when one is set or the page asks for it", () => {
    const view = render(<IncidentSidebar detail={detailFixture()} />);
    expect(screen.queryByTestId("picker-Commander")).not.toBeInTheDocument();
    view.unmount();
    render(<IncidentSidebar detail={detailFixture()} showCommander />);
    expect(screen.getByTestId("picker-Commander")).toBeInTheDocument();
  });

  it("shows a set commander by name and offers no add link without edit rights", () => {
    const detail = detailFixture();
    detail.incident.commanderUserId = "u2";
    detail.incident.commanderName = "Grace Hopper";
    const view = render(<IncidentSidebar detail={detail} />);
    expect(screen.getByTestId("picker-Commander")).toHaveTextContent("Grace Hopper");
    view.unmount();
    const viewer = detailFixture();
    viewer.permissions.canUpdate = false;
    render(<IncidentSidebar detail={viewer} />);
    expect(screen.queryByTestId("picker-Commander")).not.toBeInTheDocument();
  });

  it("status page: offers Post update when not published", () => {
    render(<IncidentSidebar detail={detailFixture()} />);
    expect(screen.getByRole("link", { name: "Post update" })).toHaveAttribute("href", "/status-pages");
  });

  it("status page: published links its status to the public incident and editors to the status page", () => {
    const detail = detailFixture();
    detail.publicIncident = { id: "pub-1", statusPageId: "sp-1", status: "in_progress" } as never;
    const view = render(<IncidentSidebar detail={detail} />);
    expect(screen.getByRole("link", { name: "in progress" })).toHaveAttribute("href", "/status-pages/sp-1/public/incidents/pub-1");
    expect(screen.getByRole("link", { name: "Post update" })).toHaveAttribute("href", "/status-pages/sp-1");
    view.unmount();
    detail.permissions.canUpdate = false;
    render(<IncidentSidebar detail={detail} />);
    expect(screen.queryByRole("link", { name: "Post update" })).not.toBeInTheDocument();
  });

  it("status page: no Post update without canUpdate", () => {
    const detail = detailFixture();
    detail.permissions.canUpdate = false;
    render(<IncidentSidebar detail={detail} />);
    expect(screen.getByText("Not published")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Post update" })).not.toBeInTheDocument();
  });

  it("collapses more than 3 alerts behind View all", () => {
    const detail = detailFixture();
    detail.linkedAlerts = alerts(5) as never;
    render(<IncidentSidebar detail={detail} />);
    expect(screen.queryByText("Alert 3")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View all 5" }));
    expect(screen.getByText("Alert 4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("Alert 3")).not.toBeInTheDocument();
  });

  it("does not offer View all for 3 or fewer alerts, and says so when none are linked", () => {
    const detail = detailFixture();
    detail.linkedAlerts = alerts(3) as never;
    const view = render(<IncidentSidebar detail={detail} />);
    expect(screen.queryByRole("button", { name: /View all/ })).not.toBeInTheDocument();
    view.unmount();
    render(<IncidentSidebar detail={detailFixture()} />);
    expect(screen.getByText("No alerts linked.")).toBeInTheDocument();
  });

  it("has no Similar row; similar incidents live in the investigation sheet", () => {
    render(<IncidentSidebar detail={detailFixture()} />);
    expect(screen.queryByRole("button", { name: /Similar past incidents/ })).not.toBeInTheDocument();
  });

  it("shows time to acknowledge (acknowledger on hover), and time to resolve once resolved", () => {
    const detail = detailFixture();
    detail.incident.acknowledgedAt = new Date("2026-06-24T12:10:00Z");
    detail.incident.acknowledgedByName = "Ada";
    detail.incident.resolvedAt = new Date("2026-06-24T14:05:00Z");
    detail.incident.status = "resolved";
    render(<IncidentSidebar detail={detail} />);
    // Who acknowledged is a hover detail, not a row.
    expect(screen.getByText("10 min").closest("[title]")).toHaveAttribute("title", expect.stringContaining("by Ada"));
    expect(screen.getByText("Time to acknowledge")).toBeInTheDocument();
    expect(screen.queryByText("Open for")).not.toBeInTheDocument();
    expect(screen.getByText("2 h 5 min")).toBeInTheDocument();
  });

  it("shows how long an open incident has been open, and Not yet before acknowledgement", () => {
    const detail = detailFixture();
    detail.incident.createdAt = new Date(Date.now() - 90 * 60_000);
    render(<IncidentSidebar detail={detail} />);
    expect(screen.getByText("Open for")).toBeInTheDocument();
    expect(screen.getByText("1 h 30 min")).toBeInTheDocument();
    expect(screen.getByText("Not yet")).toBeInTheDocument();
    expect(screen.queryByText("Time to resolve")).not.toBeInTheDocument();
  });

  it("colours the Alerts heading for firing alerts and shows the count", () => {
    const detail = detailFixture();
    detail.linkedAlerts = alerts(2) as never;
    render(<IncidentSidebar detail={detail} />);
    expect(screen.getByRole("heading", { name: "Alerts 2" })).toBeInTheDocument();
  });

  it("says Skipped for an incident resolved without acknowledgement", () => {
    const detail = detailFixture();
    detail.incident.resolvedAt = new Date("2026-06-24T14:05:00Z");
    detail.incident.status = "resolved";
    render(<IncidentSidebar detail={detail} />);
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();
  });

  it("lists the watch toggle as a plain property and leaves status and severity to the page header", () => {
    const detail = detailFixture();
    (detail.incident as { severity: string }).severity = "sev2";
    render(<IncidentSidebar detail={detail} />);
    for (const label of ["Assignee", "Service", "Started", "Status page", "Notifications"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of ["Status", "Severity", "Investigating", "sev2"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Watch" })).toBeInTheDocument();
  });
});
