import { fireEvent, render, screen } from "@testing-library/react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";

import { IncidentSidebar } from "./incident-sidebar";

let mockSimilar: unknown[] = [];
jest.mock("@/hooks/use-sre", () => ({
  useSreSimilarIncidents: () => ({ data: { success: true, incidents: mockSimilar } }),
}));
jest.mock("@/components/sre/incidents/incident-assignee-picker", () => ({
  IncidentAssigneePicker: ({ label, assigneeName }: { label: string; assigneeName: string | null }) => (
    <div data-testid={`picker-${label}`}>{label}: {assigneeName ?? "Unassigned"}</div>
  ),
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

beforeEach(() => { mockSimilar = []; });

describe("IncidentSidebar", () => {
  it("reveals the commander picker from + Add commander", () => {
    render(<IncidentSidebar detail={detailFixture()} />);
    expect(screen.queryByTestId("picker-Commander")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add commander" }));
    expect(screen.getByTestId("picker-Commander")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add commander" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "+ Add commander" })).not.toBeInTheDocument();
  });

  it("status page: not published", () => {
    render(<IncidentSidebar detail={detailFixture()} />);
    expect(screen.getByText("Not published")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Post update" })).toHaveAttribute("href", "/status-pages");
  });

  it("status page: published shows the status label and a View link", () => {
    const detail = detailFixture();
    detail.publicIncident = { id: "pub-1", statusPageId: "sp-1", status: "in_progress" } as never;
    render(<IncidentSidebar detail={detail} />);
    expect(screen.getByText("in progress")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", "/status-pages/sp-1/public/incidents/pub-1");
    expect(screen.getByRole("link", { name: "Post update" })).toHaveAttribute("href", "/status-pages/sp-1");
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

  it("hides Similar when empty and shows it when there are matches", () => {
    const view = render(<IncidentSidebar detail={detailFixture()} />);
    expect(screen.queryByText("Similar incidents")).not.toBeInTheDocument();
    view.unmount();
    mockSimilar = [{ id: "s1", incidentNumber: 3, title: "Old outage", matchedOn: ["service"], rootCauseSummary: null, resolutionSummary: null }];
    render(<IncidentSidebar detail={detailFixture()} />);
    expect(screen.getByText("Similar incidents")).toBeInTheDocument();
    expect(screen.getByText("#3 Old outage")).toBeInTheDocument();
  });

  it("shows the top 3 similar incidents with a Show more control", () => {
    mockSimilar = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, incidentNumber: i + 1, title: `Outage ${i + 1}`, matchedOn: ["service"], rootCauseSummary: null, resolutionSummary: null }));
    render(<IncidentSidebar detail={detailFixture()} />);
    expect(screen.queryByText("#4 Outage 4")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more (2)" }));
    expect(screen.getByText("#5 Outage 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("#4 Outage 4")).not.toBeInTheDocument();
  });

  it("shows MTTA and MTTR durations and the acknowledger", () => {
    const detail = detailFixture();
    detail.incident.acknowledgedAt = new Date("2026-06-24T12:10:00Z");
    detail.incident.acknowledgedByName = "Ada";
    detail.incident.resolvedAt = new Date("2026-06-24T14:05:00Z");
    detail.incident.status = "resolved";
    render(<IncidentSidebar detail={detail} />);
    expect(screen.getByText("10 min")).toBeInTheDocument();
    expect(screen.getByText("2 h 5 min")).toBeInTheDocument();
    expect(screen.getByText(/by Ada/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add commander" })).not.toBeInTheDocument();
  });
});
