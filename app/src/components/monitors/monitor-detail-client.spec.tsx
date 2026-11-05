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
let mockResults: unknown[] = [];
jest.mock("@/hooks/use-monitor-details", () => ({
  useMonitorStats: () => ({ stats: null }),
  useMonitorResults: () => ({ results: mockResults, pagination: null, isFetching: false }),
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

it("keeps check result cells on one line with an ellipsis", async () => {
  const error = "Received status code: 500, expected: 200-299 from https://example.test/health";
  mockResults = [
    {
      id: "r1",
      monitorId: "m1",
      checkedAt: new Date(Date.now() - 20_000).toISOString(),
      isUp: false,
      responseTimeMs: 360,
      location: "asia-pacific-southeast-two",
      details: { errorMessage: error },
    },
  ];
  try {
    render(<MonitorDetailClient monitor={monitor} />);

    const errorCell = await screen.findByText(error);
    const checkedAt = screen.getByText("less than a minute ago");
    const location = screen.getByText("Asia Pacific Southeast Two");
    for (const cell of [errorCell, checkedAt, location]) {
      expect(cell).toHaveClass("truncate");
      expect(cell.closest("td")).toHaveClass("overflow-hidden");
    }
    // Hover and keyboard reveal of clipped text is covered in truncated-text-with-tooltip.spec.tsx.
  } finally {
    mockResults = [];
  }
});

it("invalidates the dashboard and the single-monitor cache after pausing", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
  render(<MonitorDetailClient monitor={monitor} />);
  fireEvent.click(await screen.findByRole("button", { name: /Pause/ }));
  await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
  const keys = invalidateQueries.mock.calls.map((c) => c[0].queryKey);
  expect(keys).toContainEqual(["dashboard"]);
  expect(keys).toContainEqual(["monitor", "m1"]);
});
