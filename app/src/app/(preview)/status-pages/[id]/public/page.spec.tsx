import { render, screen } from "@testing-library/react";

jest.mock("@/actions/get-status-page", () => ({ getStatusPage: jest.fn(async () => ({ success: false })) }));
jest.mock("@/actions/get-components", () => ({ getComponents: jest.fn(async () => ({ success: false, components: [] })) }));
jest.mock("@/actions/get-incidents", () => ({ getIncidents: jest.fn(async () => ({ success: true, incidents: [] })) }));
jest.mock("@/lib/status-page-daily-metrics", () => ({ withDailyMetrics: jest.fn() }));
jest.mock("@/components/status-pages/public-status-page", () => ({ PublicStatusPage: jest.fn(() => null) }));
import PreviewPage from "./page";

it("shows an unavailable notice inside the frame instead of redirecting into the app", async () => {
  render(await PreviewPage({ params: Promise.resolve({ id: "p1" }) }));
  expect(screen.getByText("This preview is unavailable.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Status Pages" })).toHaveAttribute("target", "_top");
});

it("does not draw an empty, all-operational page when the components cannot be read", async () => {
  const { getStatusPage } = jest.requireMock("@/actions/get-status-page");
  getStatusPage.mockResolvedValueOnce({ success: true, statusPage: { id: "p1" } });
  render(await PreviewPage({ params: Promise.resolve({ id: "p1" }) }));
  expect(screen.getByText("This preview is unavailable.")).toBeInTheDocument();
});

it("shows the notice when the incidents cannot be read", async () => {
  const { getStatusPage } = jest.requireMock("@/actions/get-status-page");
  const { getComponents } = jest.requireMock("@/actions/get-components");
  const { getIncidents } = jest.requireMock("@/actions/get-incidents");
  getStatusPage.mockResolvedValueOnce({ success: true, statusPage: { id: "p1" } });
  getComponents.mockResolvedValueOnce({ success: true, components: [] });
  getIncidents.mockResolvedValueOnce({ success: false, incidents: [] });
  render(await PreviewPage({ params: Promise.resolve({ id: "p1" }) }));
  expect(screen.getByText("This preview is unavailable.")).toBeInTheDocument();
});

it("renders the page for successful empty reads", async () => {
  const { getStatusPage } = jest.requireMock("@/actions/get-status-page");
  const { getComponents } = jest.requireMock("@/actions/get-components");
  const { withDailyMetrics } = jest.requireMock("@/lib/status-page-daily-metrics");
  const { PublicStatusPage } = jest.requireMock("@/components/status-pages/public-status-page");
  getStatusPage.mockResolvedValueOnce({ success: true, statusPage: { id: "p1" } });
  getComponents.mockResolvedValueOnce({ success: true, components: [] });
  withDailyMetrics.mockResolvedValueOnce([]);
  PublicStatusPage.mockImplementationOnce(() => <p>status page</p>);
  render(await PreviewPage({ params: Promise.resolve({ id: "p1" }) }));
  expect(screen.queryByText("This preview is unavailable.")).not.toBeInTheDocument();
  expect(screen.getByText("status page")).toBeInTheDocument();
});
