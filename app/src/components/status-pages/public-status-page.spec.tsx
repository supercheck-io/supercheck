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
  const { container } = render(<PublicStatusPage statusPage={{ ...page, language: "ar" }} components={[{ ...component, dailyMetrics: [{ date: new Date().toISOString().slice(0, 10), totalChecks: 100, successfulChecks: 99 }] }]} incidents={[]} idOrSubdomain="page" />);
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

  it("shows maintenance in the block without degrading the banner", () => {
    render(<PublicStatusPage statusPage={page} components={[component]} incidents={[incident({ name: "DB upgrade", status: "scheduled", impact: "none", scheduledFor: new Date("2030-01-05T02:00:00Z"), scheduledUntil: new Date("2030-01-05T04:00:00Z") })]} idOrSubdomain="page" />);
    expect(screen.getByTestId("active-incidents")).toHaveTextContent("DB upgrade");
    expect(screen.getByText(t.allSystemsOperational)).toBeInTheDocument();
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
