import { render, screen } from "@testing-library/react";
import { PublicStatusPage } from "./public-status-page";
import { getTranslations } from "@/lib/status-page-translations";

jest.mock("./subscribe-dialog", () => ({ SubscribeDialog: () => null }));
jest.mock("./use-status-page-favicon", () => ({ useStatusPageFavicon: jest.fn() }));
const page = { id: "page", name: "Status", subdomain: "subdomain", status: "published", pageDescription: null, headline: null, supportUrl: null, createdAt: new Date(), updatedAt: new Date(), cssGreens: null, cssYellows: null, cssOranges: null, cssBlues: null, cssReds: null, faviconLogo: null, transactionalLogo: null, language: "en" };
const component = { id: "public", name: "Public API", description: null, status: "operational" as const, showcase: true, onlyShowIfDegraded: false };

it("ignores hidden outages in banner and hides healthy degraded-only components", () => {
  render(<PublicStatusPage statusPage={page} components={[component, { ...component, id: "internal", name: "Internal database", status: "major_outage", showcase: false }, { ...component, id: "conditional", name: "Conditional component", onlyShowIfDegraded: true }]} incidents={[]} idOrSubdomain="page" />);
  expect(screen.getByText(getTranslations("en").allSystemsOperational)).toBeInTheDocument();
  expect(screen.queryByText("Internal database")).not.toBeInTheDocument();
  expect(screen.queryByText("Conditional component")).not.toBeInTheDocument();
});

it("shows check-based uptime without incidents and supports Arabic direction", () => {
  const { container } = render(<PublicStatusPage statusPage={{ ...page, language: "ar" }} components={[{ ...component, monitored: true, dailyMetrics: [{ date: new Date().toISOString().slice(0, 10), totalChecks: 100, successfulChecks: 99 }] }]} incidents={[]} idOrSubdomain="page" />);
  expect(screen.getByText(/99\.00%/)).toBeInTheDocument();
  expect(container.firstChild).toHaveAttribute("dir", "rtl");
});

it("renders the maintenance window of a scheduled incident", () => {
  const incident = { id: "m1", name: "DB upgrade", status: "scheduled" as const, impact: "none" as const, createdAt: new Date(), resolvedAt: null, latestUpdate: null, scheduledFor: new Date("2030-01-05T02:00:00Z"), scheduledUntil: new Date("2030-01-05T04:00:00Z") };
  render(<PublicStatusPage statusPage={page} components={[component]} incidents={[incident]} idOrSubdomain="page" />);
  expect(screen.getByText(/Jan 5, 2030, 02:00 AM UTC.*04:00 AM UTC/)).toBeInTheDocument();
});

const t = getTranslations("en");
const incident = (over: Record<string, unknown>) => ({ id: "i1", name: "Login failures", status: "investigating" as const, impact: "major" as const, createdAt: new Date(), resolvedAt: null, latestUpdate: null, ...over });
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

describe("active incidents", () => {
  it("lists an old unresolved incident above the components, not under Past Incidents", () => {
    render(<PublicStatusPage statusPage={page} components={[component]} incidents={[incident({ createdAt: daysAgo(120) })]} idOrSubdomain="page" />);
    const active = screen.getByTestId("active-incidents");
    expect(active).toHaveTextContent("Login failures");
    expect(screen.getAllByText("Login failures")).toHaveLength(1);
    expect(active.compareDocumentPosition(screen.getByText("Public API")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not render the block for resolved incidents, which stay in Past Incidents", () => {
    render(<PublicStatusPage statusPage={page} components={[component]} incidents={[incident({ status: "resolved", resolvedAt: new Date() })]} idOrSubdomain="page" />);
    expect(screen.queryByTestId("active-incidents")).not.toBeInTheDocument();
    expect(screen.getByText("Login failures")).toBeInTheDocument();
  });

  it("never says all systems operational while a non-maintenance incident is open", () => {
    render(<PublicStatusPage statusPage={page} components={[component]} incidents={[incident({ impact: "critical" })]} idOrSubdomain="page" />);
    expect(screen.queryByText(t.allSystemsOperational)).not.toBeInTheDocument();
    expect(screen.getByText(t.majorOutage)).toBeInTheDocument();
  });

  it("takes the worst of component status and incident impact, and ignores impact none", () => {
    const { unmount } = render(<PublicStatusPage statusPage={page} components={[{ ...component, status: "partial_outage" as const }]} incidents={[incident({ impact: "critical" })]} idOrSubdomain="page" />);
    expect(screen.getByText(t.majorOutage)).toBeInTheDocument();
    unmount();
    render(<PublicStatusPage statusPage={page} components={[component]} incidents={[incident({ impact: "none" })]} idOrSubdomain="page" />);
    expect(screen.getByText(t.allSystemsOperational)).toBeInTheDocument();
    expect(screen.getByTestId("active-incidents")).toBeInTheDocument();
  });

  it("lists future maintenance under Scheduled Maintenance, not Active Incidents, without degrading the banner", () => {
    render(<PublicStatusPage statusPage={page} components={[component]} incidents={[incident({ name: "DB upgrade", status: "scheduled", impact: "none", scheduledFor: new Date("2030-01-05T02:00:00Z"), scheduledUntil: new Date("2030-01-05T04:00:00Z") })]} idOrSubdomain="page" />);
    expect(screen.queryByTestId("active-incidents")).not.toBeInTheDocument();
    expect(screen.getByTestId("upcoming-maintenance")).toHaveTextContent("DB upgrade");
    expect(screen.getByText(t.allSystemsOperational)).toBeInTheDocument();
  });

  it("does not claim no incidents today while one is active", () => {
    render(<PublicStatusPage statusPage={page} components={[component]} incidents={[incident({})]} idOrSubdomain="page" />);
    expect(screen.queryByText(new RegExp(t.noIncidentsReported))).not.toBeInTheDocument();
  });
});

describe("past incidents history", () => {
  it("only spans the days since the page was created", () => {
    render(<PublicStatusPage statusPage={{ ...page, createdAt: daysAgo(2) }} components={[component]} incidents={[]} idOrSubdomain="page" />);
    expect(screen.getAllByText(new RegExp(t.noIncidentsReported))).toHaveLength(3);
  });
});

describe("branding colours", () => {
  const render2 = (over: Record<string, unknown>) => render(<PublicStatusPage statusPage={{ ...page, ...over }} components={[component]} incidents={[]} idOrSubdomain="page" />);

  it("applies a custom background and font, and the no-data colour", () => {
    const { container } = render2({ cssBodyBackgroundColor: "#112233", cssFontColor: "#eeeeee", cssNoData: "#778899" });
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute("data-sp-branded");
    expect(root.style.backgroundColor).toBe("rgb(17, 34, 51)");
    expect(root.style.color).toBe("rgb(238, 238, 238)");
    expect(container.querySelector('[style*="rgb(119, 136, 153)"]')).not.toBeNull();
  });

  it("falls back to readable text when the configured pair has poor contrast", () => {
    const { container } = render2({ cssBodyBackgroundColor: "#111111", cssFontColor: "#222222" });
    expect((container.firstChild as HTMLElement).style.color).toBe("rgb(255, 255, 255)");
  });

  it("keeps the theme when only schema defaults are stored", () => {
    const { container } = render2({ cssBodyBackgroundColor: "#ffffff", cssFontColor: "#333333", cssNoData: "#bdc3c7" });
    expect(container.firstChild).not.toHaveAttribute("data-sp-branded");
  });
});

it("does not claim all systems operational when every component stopped reporting", () => {
  render(<PublicStatusPage statusPage={page} components={[{ ...component, noRecentData: true }]} incidents={[]} idOrSubdomain="page" />);
  expect(screen.queryByText(t.allSystemsOperational)).not.toBeInTheDocument();
  expect(screen.getAllByText(t.noRecentData).length).toBeGreaterThan(0);
});

it("an open incident still outranks stale components", () => {
  render(<PublicStatusPage statusPage={page} components={[{ ...component, noRecentData: true }]}
    incidents={[incident({ impact: "critical", status: "investigating" })]} idOrSubdomain="page" />);
  expect(screen.getByText(t.majorOutage)).toBeInTheDocument();
});

describe("uptime explanation and banner", () => {
  const today = new Date().toISOString().slice(0, 10);
  const metrics = [{ date: today, totalChecks: 100, successfulChecks: 95 }];

  it("shows a legend of the colours on screen, the days the uptime covers and when the page was read", () => {
    render(<PublicStatusPage statusPage={page} components={[{ ...component, monitored: true, dailyMetrics: metrics }]} incidents={[]} idOrSubdomain="page" />);
    const legend = screen.getByTestId("uptime-legend");
    for (const label of [t.operational, t.legendSomeDowntime, t.legendNoData]) expect(legend).toHaveTextContent(label);
    expect(legend).not.toHaveTextContent(t.legendDown);
    expect(screen.getByText(/1 of 90 days with data/)).toBeInTheDocument();
    expect(screen.getByTestId("status-updated-at")).toHaveTextContent(/^Updated \d{2}:\d{2}/);
  });

  it("darkens the default green banner just enough for white text", () => {
    render(<PublicStatusPage statusPage={page} components={[component]} incidents={[]} idOrSubdomain="page" />);
    const banner = screen.getByText(t.allSystemsOperational).closest("[style]");
    expect(banner).toHaveStyle({ color: "#ffffff" });
    expect(banner?.parentElement).toHaveStyle({ backgroundColor: "#1e874b" });
  });

  it("manual components are green since the page started and coloured by incidents, with no monitors involved", () => {
    // Fixed times: the one-hour outage stays inside one UTC day whenever the suite runs.
    const started = new Date("2026-11-12T12:00:00Z");
    const incident = { id: "i1", name: "Login errors", status: "resolved" as const, impact: "critical" as const, createdAt: new Date("2026-11-20T10:00:00Z"), resolvedAt: new Date("2026-11-20T11:00:00Z"), latestUpdate: null, affectedComponents: [{ id: "public", name: "Public API" }] };
    render(<PublicStatusPage statusPage={page} components={[{ ...component, createdAt: started }]} incidents={[incident]} idOrSubdomain="page" readAt="2026-11-22T12:00:00Z" />);
    const legend = screen.getByTestId("uptime-legend");
    expect(legend).toHaveTextContent(t.operational);
    expect(legend).toHaveTextContent(t.legendDown);
    expect(legend).toHaveTextContent(t.legendNoData);
    expect(screen.getByText(/% uptime/)).not.toHaveTextContent(/^100\.00%/);
    expect(screen.getByText(/11 of 90 days with data/)).toBeInTheDocument();
  });

  it("says no incidents reported today without a capitalised Today", () => {
    render(<PublicStatusPage statusPage={page} components={[component]} incidents={[]} idOrSubdomain="page" />);
    expect(screen.getByText(t.noIncidentsReportedToday)).toBeInTheDocument();
    expect(screen.queryByText(/reported Today/)).not.toBeInTheDocument();
  });
});

it("draws the bars from the server's read time, so a render after midnight UTC shows the same days", () => {
  render(<PublicStatusPage statusPage={{ ...page, createdAt: new Date("2026-11-01T00:00:00Z") }} components={[{ ...component, createdAt: new Date("2026-11-01T00:00:00Z") }]} incidents={[]} idOrSubdomain="page" readAt="2026-11-10T23:59:00Z" />);
  expect(screen.getByText(/10 of 90 days with data/)).toBeInTheDocument();
});
