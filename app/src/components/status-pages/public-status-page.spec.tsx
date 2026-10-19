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
