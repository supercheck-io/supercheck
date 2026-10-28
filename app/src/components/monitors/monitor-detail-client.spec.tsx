import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MonitorDetailClient } from "./monitor-detail-client";

const invalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useIsRestoring: () => false,
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/actions/delete-monitor", () => ({ deleteMonitor: jest.fn() }));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ recentMonitorResultsLimit: 10 }) }));
jest.mock("@/hooks/use-locations", () => ({ useLocationMetadata: () => ({ locations: [] }) }));
jest.mock("@/hooks/use-monitors", () => ({
  MONITORS_QUERY_KEY: ["monitors"],
  MONITOR_QUERY_KEY: ["monitor"],
}));
jest.mock("@/hooks/use-dashboard", () => ({ DASHBOARD_QUERY_KEY: ["dashboard"] }));
jest.mock("@/hooks/use-monitor-details", () => ({
  useMonitorStats: () => ({ stats: null }),
  useMonitorResults: () => ({ results: [], pagination: null, isFetching: false }),
  useMonitorPermissions: () => ({ canEdit: true, canDelete: true, canToggle: true, isLoading: false }),
}));
jest.mock("@/components/shared/report-viewer", () => ({ ReportViewer: () => null }));
jest.mock("@/components/monitors/ai-monitor-analyze-button", () => ({ AIMonitorAnalyzeButton: () => null }));
jest.mock("@/components/monitors/response-time-line-chart", () => ({ ResponseTimeBarChart: () => null }));
jest.mock("./AvailabilityBarChart", () => ({ AvailabilityBarChart: () => null }));
jest.mock("./location-filter-dropdown", () => ({ LocationFilterDropdown: () => null }));
jest.mock("@/components/nav-user", () => ({ NavUser: () => null }));
jest.mock("@/components/ui/calendar", () => ({ Calendar: () => null }));

const monitor = {
  id: "m1",
  name: "Site",
  type: "website",
  target: "https://example.test",
  status: "up",
  frequencyMinutes: 5,
  recentResults: [],
} as never;

it("invalidates the dashboard and the single-monitor cache after pausing", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
  render(<MonitorDetailClient monitor={monitor} />);
  fireEvent.click(await screen.findByRole("button", { name: /Pause/ }));
  await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
  const keys = invalidateQueries.mock.calls.map((c) => c[0].queryKey);
  expect(keys).toContainEqual(["dashboard"]);
  expect(keys).toContainEqual(["monitor", "m1"]);
});
