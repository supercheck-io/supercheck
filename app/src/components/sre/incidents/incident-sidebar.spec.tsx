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

  it("shows one Similar past incidents row that opens the list, only when there are matches", () => {
    const onOpenSimilar = jest.fn();
    const view = render(<IncidentSidebar detail={detailFixture()} onOpenSimilar={onOpenSimilar} />);
    expect(screen.queryByRole("button", { name: /Similar past incidents/ })).not.toBeInTheDocument();
    view.unmount();
    mockSimilar = [{ id: "s1" }, { id: "s2" }];
    render(<IncidentSidebar detail={detailFixture()} onOpenSimilar={onOpenSimilar} />);
    const row = screen.getByRole("button", { name: /Similar past incidents/ });
    expect(row).toHaveTextContent("2");
    fireEvent.click(row);
    expect(onOpenSimilar).toHaveBeenCalled();
  });


  it("shows who acknowledged, time to acknowledge, and time to resolve once resolved", () => {
    const detail = detailFixture();
    detail.incident.acknowledgedAt = new Date("2026-06-24T12:10:00Z");
    detail.incident.acknowledgedByName = "Ada";
    detail.incident.resolvedAt = new Date("2026-06-24T14:05:00Z");
    detail.incident.status = "resolved";
    render(<IncidentSidebar detail={detail} />);
    expect(screen.getByText(/by Ada/)).toBeInTheDocument();
    expect(screen.getByText("10 min")).toBeInTheDocument();
    expect(screen.getByText("2 h 5 min")).toBeInTheDocument();
  });

  it("says Skipped for an incident resolved without acknowledgement", () => {
    const detail = detailFixture();
    detail.incident.resolvedAt = new Date("2026-06-24T14:05:00Z");
    detail.incident.status = "resolved";
    render(<IncidentSidebar detail={detail} />);
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.queryByText("Time to acknowledge")).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Details" })).toBeInTheDocument();
  });
});
