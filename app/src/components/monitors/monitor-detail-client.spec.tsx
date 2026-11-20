import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MonitorDetailClient } from "./monitor-detail-client";

const invalidateQueries = jest.fn();
jest.mock("@/components/sre/incidents/new-incident-action", () => ({ NewIncidentAction: () => null }));
jest.mock("@/components/maintenance/maintenance-windows-panel", () => ({
  MonitorMaintenanceBar: () => null,
  ServiceMaintenanceAction: () => null,
  maintenanceEndLabel: (end: Date) => end.toISOString(),
}));
let mockWindows: unknown[] | undefined;
const maintenanceQuery = jest.fn(() => ({ data: mockWindows }));
// The real hook reads the project context, which the notification view has none of.
jest.mock("@/hooks/use-maintenance-windows", () => ({ useMaintenanceWindows: () => maintenanceQuery() }));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useIsRestoring: () => false,
}));
const mockReplace = jest.fn();
let mockSearch = "";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: mockReplace }),
  usePathname: () => "/monitors/hb1",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
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
let mockPagination: { total: number; totalPages?: number } | null = null;
let mockFetching = false;
let mockPlaceholder = false;
let locationFilterProps: { availableLocations: string[] } | null = null;
jest.mock("@/hooks/use-monitor-details", () => ({
  useMonitorStats: () => ({ stats: null }),
  useMonitorResults: () => ({ results: mockResults, pagination: mockPagination, isFetching: mockFetching, isPlaceholderData: mockPlaceholder }),
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
  AvailabilityBarChart: ({ headerActions, footer }: { headerActions?: React.ReactNode; footer?: React.ReactNode }) => <>{headerActions}{footer}</>,
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

    // The failure text is back in its own Error column, clipped with the full text on hover.
    expect(screen.getByRole("columnheader", { name: "Error" })).toBeInTheDocument();
    expect(await screen.findByTestId("result-error")).toHaveTextContent(error);
    expect(screen.getByText(error)).toHaveClass("truncate");
    expect(screen.queryByRole("button", { name: "Show error" })).toBeNull();
    // Compact time never truncates; the full timestamp is in the title.
    const checkedAt = screen.getByText("just now");
    expect(checkedAt).toHaveAttribute("title", expect.stringMatching(/^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}:\d{2}$/));
    expect(checkedAt).toHaveClass("whitespace-nowrap");
    const location = screen.getByText("Asia Pacific Southeast Two");
    for (const cell of [location]) {
      expect(cell).toHaveClass("truncate");
      expect(cell.closest("td")).toHaveClass("overflow-hidden");
    }
    // Hover and keyboard reveal of clipped text is covered in truncated-text-with-tooltip.spec.tsx.
  } finally {
    mockResults = [];
  }
});

it("shows the report button in the Result cell and the error in the Error column for a failed synthetic check", async () => {
  mockResults = [{ id: "r7", monitorId: "m9", checkedAt: new Date().toISOString(), isUp: false, responseTimeMs: 40, location: null, testExecutionId: "run1", details: { reportUrl: "r", errorMessage: "boom" } }];
  try {
    render(<MonitorDetailClient monitor={{ id: "m9", name: "Bot", type: "synthetic_test", target: "t1", status: "down", frequencyMinutes: 5, config: { testId: "t1" }, recentResults: [] } as never} />);
    expect(await screen.findByRole("button", { name: "View test report" })).toBeInTheDocument();
    expect(screen.getByTestId("result-error")).toHaveTextContent("boom");
  } finally {
    mockResults = [];
  }
});

it("shows a dash for an invalid check time and accepts a Date or a number", async () => {
  const row = (id: string, checkedAt: unknown) => ({ id, monitorId: "m1", checkedAt, isUp: true, responseTimeMs: 10, location: null, details: null });
  mockResults = [row("a", "not a date"), row("b", new Date(Date.now() - 3 * 3_600_000)), row("c", Date.now() - 2 * 86_400_000)];
  try {
    render(<MonitorDetailClient monitor={monitor} />);
    expect(await screen.findByText("3h ago")).toBeInTheDocument();
    expect(screen.getByText("2d ago")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  } finally {
    mockResults = [];
  }
});

it("shows a check time in compact form", async () => {
  mockResults = [{ id: "r1", monitorId: "m1", checkedAt: new Date(Date.now() - 2 * 3_600_000 - 5_000).toISOString(), isUp: true, responseTimeMs: 40, location: null, details: null }];
  try {
    render(<MonitorDetailClient monitor={monitor} />);
    expect(await screen.findByText("2h ago")).toBeInTheDocument();
  } finally {
    mockResults = [];
  }
});

it("shows N/A in the Error column for a passing check", async () => {
  mockResults = [{ id: "r1", monitorId: "m1", checkedAt: new Date().toISOString(), isUp: true, responseTimeMs: 40, location: null, details: null }];
  try {
    render(<MonitorDetailClient monitor={monitor} />);
    expect(await screen.findByText("40 ms")).toBeInTheDocument();
    expect(screen.getByTestId("result-error")).toHaveTextContent("N/A");
  } finally {
    mockResults = [];
  }
});

describe("MCP server monitor detail", () => {
  const mcpMonitor = {
    id: "m2", name: "Freight MCP", type: "mcp_server", target: "https://mcp.example.test", status: "up", frequencyMinutes: 5,
    config: { mcpState: { baseline: { hash: "h", takenAt: "2026-11-01T00:00:00Z", tools: [{ name: "track", fingerprint: "f" }] } } },
    recentResults: [],
  } as never;
  const mcpRow = { id: "r5", monitorId: "m2", checkedAt: new Date().toISOString(), isUp: true, responseTimeMs: 120, location: null, details: { mcp: { toolCount: 4, protocol: "2025-06-18", serverName: "lumen-freight-mcp", serverVersion: "1.8.2" } } };

  it("puts the tools, server and protocol in a popover from the Tools button, not a card under the charts", async () => {
    mockResults = [mcpRow];
    try {
      render(<MonitorDetailClient monitor={{ ...(mcpMonitor as object), recentResults: [mcpRow] } as never} />);
      expect(screen.queryByText("MCP server")).toBeNull();
      expect(screen.queryByTestId("mcp-tools-panel")).toBeNull();
      expect(screen.getAllByText(/^(Current|Last 24 hours|Last 30 days)$/)).toHaveLength(3);
      fireEvent.click(screen.getByTestId("mcp-tools-button"));
      expect(await screen.findByTestId("mcp-server-meta")).toHaveTextContent("lumen-freight-mcp 1.8.2 · MCP 2025-06-18");
      expect(screen.getByTestId("mcp-tool-list")).toHaveTextContent("track");
      expect(await screen.findByTestId("mcp-row-tools")).toHaveTextContent("4");
    } finally {
      mockResults = [];
    }
  });

  it("ends the columns with Error and drops the minimum width on desktop", async () => {
    mockResults = [mcpRow];
    try {
      render(<MonitorDetailClient monitor={mcpMonitor} />);
      expect(await screen.findByTestId("mcp-row-tools")).toBeInTheDocument();
      expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Result", "Checked At", "Location", "Response", "Tools", "Error"]);
      expect(screen.getByRole("table")).toHaveClass("lg:min-w-0");
    } finally {
      mockResults = [];
    }
  });
});

it("badges a check made during maintenance in the results table", async () => {
  const row = (id: string, inMaintenance: boolean) => ({
    id, monitorId: "m1", checkedAt: new Date().toISOString(), isUp: false, responseTimeMs: 10, location: null, details: null, inMaintenance,
  });
  mockResults = [row("r1", true), row("r2", false)];
  try {
    render(<MonitorDetailClient monitor={monitor} />);
    const badges = await screen.findAllByTestId("result-maintenance-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAccessibleName("Checked during maintenance");
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

  it("keeps first token, tokens and models in the AI details popover, with host and model as the subtitle", async () => {
    mockResults = [result({ ai })];
    try {
      render(<MonitorDetailClient monitor={aiMonitor()} />);
      expect(screen.queryByTestId("ai-endpoint-panel")).toBeNull();
      fireEvent.click(screen.getByTestId("ai-endpoint-button"));
      expect(screen.getByTestId("ai-stat-first-token")).toHaveTextContent("First token");
      expect(screen.getByTestId("ai-stat-first-token")).toHaveTextContent("420");
      expect(screen.getByTestId("ai-stat-tokens")).toHaveTextContent("Tokens per call");
      expect(screen.getByTestId("ai-stat-tokens")).toHaveTextContent("1,234");
      expect(screen.getByTestId("ai-stat-served-model")).toHaveTextContent("gpt-4o-mini-2024-07-18");
      expect(screen.getByTestId("ai-stat-requested-model")).toHaveTextContent("gpt-4o-mini");
      expect(screen.getByTestId("ai-stat-token-split")).toHaveTextContent("15 / 6");
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
      fireEvent.click(screen.getByTestId("ai-endpoint-button"));
      expect(screen.getByTestId("ai-stat-first-token")).toHaveTextContent("823 ms");
      expect(screen.getByTestId("ai-stat-first-token")).not.toHaveTextContent("823.4");
      expect(chartProps?.data[0].firstToken).toBe(823);
    } finally {
      mockResults = [];
    }
  });

  it("shows dashes before the first check and ignores any stored aiEndpointState", () => {
    render(<MonitorDetailClient monitor={aiMonitor({ recentResults: [], config: { aiEndpoint: { model: "m" }, aiEndpointState: { lastServedModel: "stored-model" } } })} />);
    fireEvent.click(screen.getByTestId("ai-endpoint-button"));
    expect(screen.getByTestId("ai-endpoint-panel")).toHaveTextContent("Shown after the first check.");
    expect(screen.getByTestId("ai-stat-served-model")).toHaveTextContent("—");
    expect(screen.getByTestId("ai-stat-first-token")).toHaveTextContent("—");
  });

  it("adds nothing for a plain HTTP monitor", () => {
    render(<MonitorDetailClient monitor={{ ...(monitor as object), type: "http_request", config: { method: "GET" } } as never} />);
    expect(screen.queryByTestId("ai-endpoint-button")).toBeNull();
    expect(screen.queryByTestId("monitor-ai-subtitle")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "First token" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Tokens" })).toBeNull();
    expect(chartProps?.showFirstToken).toBe(false);
  });
});

describe("heartbeat monitor detail", () => {
  const summary = (state: string, extra: Record<string, unknown> = {}) => ({
    state,
    lastPingAt: null,
    lastPingKind: null,
    lastStartAt: null,
    nextExpectedAt: null,
    graceMinutes: 10,
    ...extra,
  });
  const heartbeatMonitor = (state: string, extra: Record<string, unknown> = {}, recentResults: unknown[] = []) =>
    ({
      id: "hb1",
      name: "Nightly backup",
      type: "heartbeat",
      target: "",
      status: state === "late" ? "up" : state,
      frequencyMinutes: 60,
      recentResults,
      heartbeat: summary(state, extra),
    }) as never;

  beforeEach(() => {
    chartProps = null;
    mockSearch = "";
    mockReplace.mockClear();
    global.fetch = jest.fn() as never;
  });

  const pinged = (extra: Record<string, unknown> = {}) => ({
    lastPingAt: new Date(Date.now() - 60_000).toISOString(),
    nextExpectedAt: new Date(Date.now() + 3_540_000).toISOString(),
    ...extra,
  });
  const runRow = { id: "r1", monitorId: "hb1", checkedAt: new Date(Date.now() - 60_000).toISOString(), isUp: true, responseTimeMs: 248_000, location: "local", details: { heartbeat: { kind: "ping" } } };

  it.each(["up", "late", "down", "pending", "paused"])("shows the %s badge and the schedule, not a target", (state) => {
    render(<MonitorDetailClient monitor={heartbeatMonitor(state)} />);
    expect(screen.getByTestId("heartbeat-state-badge")).toHaveAttribute("data-state", state);
    expect(screen.getByTestId("monitor-heartbeat-subtitle")).toHaveTextContent("Every 1 h · grace 10 min");
  });

  it("shows ping and uptime stat cards in the header, not response-time ones", () => {
    render(<MonitorDetailClient monitor={heartbeatMonitor("up", pinged())} />);
    const header = screen.getByTestId("monitor-detail-header");
    for (const label of ["Pings", "Uptime", "Last 24 hours", "Last 30 days"]) {
      expect(within(header).getByText(label)).toBeInTheDocument();
    }
    for (const label of ["Avg Resp", "P95 Resp", "Current"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("shows the URL panel, waiting note and both empty cards for a never-pinged monitor", async () => {
    render(<MonitorDetailClient monitor={heartbeatMonitor("pending")} />);
    expect(screen.queryByRole("tab", { name: "Setup" })).toBeNull();
    expect(screen.getByTestId("heartbeat-ping-url-panel")).toBeInTheDocument();
    expect(screen.getByTestId("heartbeat-waiting")).toHaveTextContent("Waiting for the first ping");
    expect(screen.getByTestId("heartbeat-ping-history")).toBeInTheDocument();
    expect(screen.getByTestId("heartbeat-ping-history-empty")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Reveal" })).toBeInTheDocument();
  });

  it("shows the URL panel and ping history together once pinged, with no tabs", () => {
    render(<MonitorDetailClient monitor={heartbeatMonitor("up", pinged())} />);
    expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull();
    expect(screen.getByTestId("heartbeat-ping-url-panel")).toBeInTheDocument();
    expect(screen.getByTestId("heartbeat-ping-history")).toBeInTheDocument();
    expect(screen.queryByTestId("heartbeat-waiting")).toBeNull();
  });

  it("keeps the heartbeat layout without a summary, as in the notification view", () => {
    const { heartbeat: omitted, ...bare } = heartbeatMonitor("up") as unknown as Record<string, unknown>;
    void omitted;
    maintenanceQuery.mockClear();
    render(<MonitorDetailClient monitor={bare as never} isNotificationView />);
    expect(maintenanceQuery).not.toHaveBeenCalled();
    expect(screen.getByTestId("heartbeat-layout")).toBeInTheDocument();
    expect(screen.getByTestId("heartbeat-ping-history")).toBeInTheDocument();
    expect(screen.queryByTestId("heartbeat-overview")).toBeNull();
  });

  it("shows last ping, next ping, run and uptime in the header stats and the schedule in the subtitle", () => {
    render(<MonitorDetailClient monitor={heartbeatMonitor("up", pinged(), [runRow])} />);
    const overview = screen.getByTestId("heartbeat-overview");
    for (const label of ["Last ping", "Next ping", "Last run", "Last 24 hours", "Last 30 days"]) {
      expect(within(overview).getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByTestId("monitor-heartbeat-subtitle")).toHaveTextContent("Every 1 h · grace 10 min");
  });

  it("shows last ping, next ping and last run duration in the overview", () => {
    render(<MonitorDetailClient monitor={heartbeatMonitor("up", pinged(), [runRow])} />);
    expect(screen.getByTestId("heartbeat-stat-last-ping")).toHaveTextContent(/^1m ago$/);
    expect(screen.getByTestId("heartbeat-stat-next")).toHaveTextContent(/^in 5[89]m$/);
    expect(screen.getByTestId("heartbeat-stat-duration")).toHaveTextContent("4 min 08 s");
  });

  it("offers the run duration chart beside availability only when durations exist, else shows a one-line hint", () => {
    const { unmount } = render(<MonitorDetailClient monitor={heartbeatMonitor("up", pinged())} />);
    expect(chartProps).toBeNull();
    expect(screen.queryByRole("button", { name: "Run duration" })).toBeNull();
    expect(screen.getByTestId("heartbeat-run-duration-hint")).toBeInTheDocument();
    unmount();
    render(<MonitorDetailClient monitor={heartbeatMonitor("up", pinged(), [runRow])} />);
    expect(screen.queryByTestId("heartbeat-run-duration-hint")).toBeNull();
    expect(chartProps).toBeNull();
    const tab = screen.getByRole("button", { name: "Run duration" });
    fireEvent.click(tab);
    expect(chartProps).toMatchObject({ title: "Run duration" });
  });

  it("shows Paused instead of a deadline while paused", () => {
    render(<MonitorDetailClient monitor={heartbeatMonitor("paused", pinged())} />);
    expect(screen.getByTestId("heartbeat-stat-next")).toHaveTextContent("Paused");
  });

  it("omits the next ping before the first ping, whatever the summary holds", () => {
    render(<MonitorDetailClient monitor={heartbeatMonitor("pending", { nextExpectedAt: new Date(Date.now() - 60_000).toISOString() })} />);
    expect(screen.getByTestId("heartbeat-stat-last-ping")).toHaveTextContent("No pings yet");
    expect(screen.getByTestId("heartbeat-stat-next")).toHaveTextContent("—");
    expect(screen.getByTestId("heartbeat-stat-duration")).toHaveTextContent("—");
  });

  it("shows overdue when down", () => {
    render(<MonitorDetailClient monitor={heartbeatMonitor("down", pinged({ lastPingAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), nextExpectedAt: new Date(Date.now() - 3 * 60_000).toISOString() }))} />);
    expect(screen.getByTestId("heartbeat-stat-last-ping")).toHaveTextContent(/^3h ago$/);
    expect(screen.getByTestId("heartbeat-stat-next")).toHaveTextContent(/^overdue 3m$/);
  });
});

describe("agent test monitor", () => {
  const row = (details: object) => ({
    id: "r9", monitorId: "m9", checkedAt: new Date(Date.now() - 20_000).toISOString(), isUp: true, status: "up", isStatusChange: false, responseTimeMs: 900, location: "eu-central", details,
  });
  const synthetic = { id: "m9", name: "Bot", type: "synthetic_test", target: "t1", status: "up", frequencyMinutes: 5, config: { testId: "t1" }, recentResults: [] } as never;

  it("adds a Pass rate column from details.agent", async () => {
    mockResults = [row({ agent: { passRate: 0.8, attempts: 10, totalTokens: 900 } })];
    try {
      render(<MonitorDetailClient monitor={synthetic} />);
      expect(screen.getByRole("columnheader", { name: "Pass rate" })).toBeInTheDocument();
      expect(await screen.findByTestId("agent-row-pass-rate")).toHaveTextContent("80%");
    } finally {
      mockResults = [];
    }
  });

  it("keeps the Pass rate column when the current page has no agent rows but loaded results do", () => {
    mockResults = [row({})];
    try {
      render(<MonitorDetailClient monitor={{ ...(synthetic as object), recentResults: [row({ agent: { passRate: 1 } })] } as never} />);
      expect(screen.getByRole("columnheader", { name: "Pass rate" })).toBeInTheDocument();
    } finally {
      mockResults = [];
    }
  });

  it("has no Pass rate column for a synthetic monitor on another test type", async () => {
    mockResults = [row({})];
    try {
      render(<MonitorDetailClient monitor={synthetic} />);
      expect(screen.queryByRole("columnheader", { name: "Pass rate" })).toBeNull();
    } finally {
      mockResults = [];
    }
  });
});

describe("detail header and results table", () => {
  afterEach(() => {
    mockResults = [];
    mockPagination = null;
    mockFetching = false;
    mockPlaceholder = false;
    mockWindows = undefined;
  });
  const row = (id: string) => ({ id, monitorId: "m1", checkedAt: new Date().toISOString(), isUp: true, responseTimeMs: 40, location: null, details: null });

  it("truncates a long name and target with the full text in the title instead of cutting at 40 characters", () => {
    const name = "Checkout API production health check for the EU fulfillment region and partner integrations";
    const target = "https://checkout-api.example.test/v2/health/deep?include=db,cache,queue,partners";
    render(<MonitorDetailClient monitor={{ ...(monitor as object), name, target, url: target } as never} />);
    const title = screen.getByTestId("monitor-detail-name");
    expect(title).toHaveTextContent(name);
    expect(title).toHaveClass("truncate");
    expect(title).toHaveAttribute("title", name);
    expect(screen.getByTestId("monitor-detail-target")).toHaveClass("truncate");
    expect(screen.getByTestId("monitor-detail-target")).toHaveAttribute("title", target);
    expect(screen.getByTestId("monitor-detail-actions")).toHaveClass("lg:flex-nowrap");
  });

  it("never queries maintenance windows in the notification view, which has no project context", () => {
    maintenanceQuery.mockClear();
    render(<MonitorDetailClient monitor={monitor} isNotificationView />);
    expect(maintenanceQuery).not.toHaveBeenCalled();
    render(<MonitorDetailClient monitor={monitor} />);
    expect(maintenanceQuery).toHaveBeenCalled();
  });

  it("names the icon-only actions for screen readers", () => {
    render(<MonitorDetailClient monitor={monitor} />);
    for (const name of ["Pause", "Edit", "Delete"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("shows an active maintenance window under the name", () => {
    mockWindows = [{ id: "w1", timezone: "UTC", occurrenceEndsAt: "2026-11-19T14:00:00.000Z" }];
    render(<MonitorDetailClient monitor={monitor} />);
    expect(screen.getByTestId("monitor-maintenance-status")).toHaveTextContent("In maintenance until 2026-11-19T14:00:00.000Z");
  });

  it("shows skeleton rows the size of the page on the first load, not a spinner", () => {
    mockFetching = true;
    render(<MonitorDetailClient monitor={monitor} />);
    const skeleton = screen.getAllByTestId("monitor-result-skeleton");
    expect(skeleton).toHaveLength(10);
    expect(skeleton[0].querySelectorAll("td")).toHaveLength(5);
    expect(screen.queryByText("Loading check results")).toBeNull();
  });

  it("shows skeleton rows while another page loads, but keeps the rows during a background refresh", () => {
    mockResults = [row("r1")];
    mockPagination = { total: 1, totalPages: 1 };
    mockFetching = true;
    mockPlaceholder = true;
    const { rerender } = render(<MonitorDetailClient monitor={monitor} />);
    expect(screen.getAllByTestId("monitor-result-skeleton")).toHaveLength(10);
    mockPlaceholder = false;
    rerender(<MonitorDetailClient monitor={monitor} />);
    expect(screen.queryByTestId("monitor-result-skeleton")).toBeNull();
    expect(screen.getAllByTestId("monitor-result-row")).toHaveLength(1);
  });

  it("shows the pager on a single page, so the height reserved for it is never empty", () => {
    mockResults = [row("r1")];
    mockPagination = { total: 1, totalPages: 1 };
    render(<MonitorDetailClient monitor={monitor} />);
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
