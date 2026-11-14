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
let chartProps: { data: { firstToken?: number | null }[]; showFirstToken?: boolean } | null = null;
jest.mock("@/components/monitors/response-time-line-chart", () => ({
  ResponseTimeBarChart: (props: typeof chartProps) => {
    chartProps = props;
    return null;
  },
}));
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

describe("AI endpoint monitor", () => {
  const ai = { firstTokenMs: 420, totalMs: 900, servedModel: "gpt-4o-mini-2024-07-18", promptTokens: 15, completionTokens: 6, totalTokens: 1234 };
  const result = (details: object) => ({
    id: "r1", monitorId: "m2", checkedAt: new Date(Date.now() - 20_000).toISOString(), isUp: true, status: "up", isStatusChange: false, responseTimeMs: 900, location: "eu-central", details,
  });
  const aiMonitor = (extra: object = {}) =>
    ({
      id: "m2", name: "LLM", type: "http_request", target: "https://api.openai.com/v1/chat/completions", status: "up", frequencyMinutes: 5,
      config: { aiEndpoint: { model: "gpt-4o-mini" } }, recentResults: [result({ ai })], ...extra,
    }) as never;

  it("shows first token, tokens per call and served model, with host and model as the subtitle", async () => {
    mockResults = [result({ ai })];
    try {
      render(<MonitorDetailClient monitor={aiMonitor()} />);
      expect(screen.getByTestId("ai-stat-first-token")).toHaveTextContent("First token");
      expect(screen.getByTestId("ai-stat-first-token")).toHaveTextContent("420");
      expect(screen.getByTestId("ai-stat-tokens")).toHaveTextContent("Tokens per call");
      expect(screen.getByTestId("ai-stat-tokens")).toHaveTextContent("1,234");
      expect(screen.getByTestId("ai-stat-served-model")).toHaveTextContent("gpt-4o-mini-2024-07-18");
      expect(screen.getByTestId("monitor-ai-subtitle")).toHaveTextContent("api.openai.com · gpt-4o-mini");
      expect(screen.getByRole("columnheader", { name: "First token" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Tokens" })).toBeInTheDocument();
      expect(await screen.findByTestId("ai-row-first-token")).toHaveTextContent("420");
      expect(screen.getByTestId("ai-row-tokens")).toHaveTextContent("1,234");
      expect(chartProps?.showFirstToken).toBe(true);
      expect(chartProps?.data[0].firstToken).toBe(420);
    } finally {
      mockResults = [];
    }
  });

  it("rounds a fractional first token value for the stat, the table and the chart", async () => {
    const fractional = result({ ai: { ...ai, firstTokenMs: 823.418292 } });
    mockResults = [fractional];
    try {
      render(<MonitorDetailClient monitor={aiMonitor({ recentResults: [fractional] })} />);
      expect(screen.getByTestId("ai-stat-first-token")).toHaveTextContent("823 ms");
      expect(screen.getByTestId("ai-stat-first-token")).not.toHaveTextContent("823.4");
      expect(chartProps?.data[0].firstToken).toBe(823);
    } finally {
      mockResults = [];
    }
  });

  it("shows dashes before the first check and ignores any stored aiEndpointState", () => {
    render(<MonitorDetailClient monitor={aiMonitor({ recentResults: [], config: { aiEndpoint: { model: "m" }, aiEndpointState: { lastServedModel: "stored-model" } } })} />);
    expect(screen.getByTestId("ai-stat-served-model")).toHaveTextContent("—");
    expect(screen.getByTestId("ai-stat-first-token")).toHaveTextContent("—");
  });

  it("adds nothing for a plain HTTP monitor", () => {
    render(<MonitorDetailClient monitor={{ ...(monitor as object), type: "http_request", config: { method: "GET" } } as never} />);
    expect(screen.queryByTestId("ai-stat-first-token")).toBeNull();
    expect(screen.queryByTestId("monitor-ai-subtitle")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "First token" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Tokens" })).toBeNull();
    expect(chartProps?.showFirstToken).toBe(false);
  });
});
