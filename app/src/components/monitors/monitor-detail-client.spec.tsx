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
let mockPagination: { total: number } | null = null;
let locationFilterProps: { availableLocations: string[] } | null = null;
jest.mock("@/hooks/use-monitor-details", () => ({
  useMonitorStats: () => ({ stats: null }),
  useMonitorResults: () => ({ results: mockResults, pagination: mockPagination, isFetching: false }),
  useMonitorPermissions: () => ({ canEdit: true, canDelete: true, canToggle: true, isLoading: false }),
}));
jest.mock("@/components/shared/report-viewer", () => ({ ReportViewer: () => null }));
jest.mock("@/components/monitors/ai-monitor-analyze-button", () => ({ AIMonitorAnalyzeButton: () => null }));
jest.mock("@/components/monitors/response-time-line-chart", () => ({ ResponseTimeBarChart: () => null }));
jest.mock("./AvailabilityBarChart", () => ({
  AvailabilityBarChart: ({ headerActions }: { headerActions?: React.ReactNode }) => <>{headerActions}</>,
}));
jest.mock("./location-filter-dropdown", () => ({
  LocationFilterDropdown: (props: { availableLocations: string[] }) => {
    locationFilterProps = props;
    return null;
  },
}));
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

const checkResult = (responseTimeMs: number) => ({
  id: `r${responseTimeMs}`,
  monitorId: "m1",
  checkedAt: new Date(Date.now() - 20_000).toISOString(),
  isUp: true,
  responseTimeMs,
  location: "eu-central",
  details: {},
});

it("shows response times in ms below one second and in seconds above", async () => {
  mockResults = [checkResult(360), checkResult(1250)];
  try {
    render(<MonitorDetailClient monitor={monitor} />);
    expect(await screen.findByText("360 ms")).toBeInTheDocument();
    expect(screen.getByText("1.25 s")).toBeInTheDocument();
  } finally {
    mockResults = [];
  }
});

it("does not append + to the exact paginated result count", async () => {
  mockResults = [checkResult(100)];
  mockPagination = { total: 25 };
  try {
    render(<MonitorDetailClient monitor={monitor} />);
    expect(await screen.findByText("Showing 1 of 25 recent checks.")).toBeInTheDocument();
  } finally {
    mockResults = [];
    mockPagination = null;
  }
});

it("offers every configured location in the filter, not only those seen in recent results", async () => {
  locationFilterProps = null;
  const configured = {
    ...(monitor as object),
    config: { locationConfig: { enabled: true, locations: ["us-east", "eu-central"], threshold: 50, strategy: "majority" } },
    recentResults: [],
  } as never;
  render(<MonitorDetailClient monitor={configured} />);
  await waitFor(() => expect(locationFilterProps?.availableLocations).toEqual(["eu-central", "us-east"]));
});

it("ignores a non-array locations value instead of crashing", async () => {
  const bad = { ...(monitor as object), config: { locationConfig: { locations: "eu-central" } }, recentResults: [] } as never;
  expect(() => render(<MonitorDetailClient monitor={bad} />)).not.toThrow();
});
