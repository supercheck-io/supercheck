import { act, fireEvent, render, screen } from "@testing-library/react";
import { MonitorDetailClient } from "./monitor-detail-client";
import { format, startOfDay, subDays } from "date-fns";
import { rawCutoff } from "@/lib/raw-cutoff";

jest.mock("@/components/sre/incidents/new-incident-action", () => ({ NewIncidentAction: () => null }));
jest.mock("@/components/maintenance/maintenance-windows-panel", () => ({
  MonitorMaintenanceBar: () => null,
  ServiceMaintenanceAction: () => null,
  maintenanceEndLabel: (end: Date) => end.toISOString(),
}));
jest.mock("@/hooks/use-maintenance-windows", () => ({ useMaintenanceWindows: () => ({ data: [] }) }));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useIsRestoring: () => false,
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/monitors/m1",
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/actions/delete-monitor", () => ({ deleteMonitor: jest.fn() }));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ recentMonitorResultsLimit: 10 }) }));
jest.mock("@/hooks/use-locations", () => ({ useLocationMetadata: () => ({ locations: [] }) }));
jest.mock("@/hooks/use-monitors", () => ({ MONITORS_QUERY_KEY: ["monitors"], MONITOR_QUERY_KEY: ["monitor"] }));
jest.mock("@/hooks/use-dashboard", () => ({ DASHBOARD_QUERY_KEY: ["dashboard"] }));

type ResultsOptions = { page: number; limit: number; date?: Date; location?: string; failuresOnly?: boolean };
const resultsCalls: ResultsOptions[] = [];
let mockResults: unknown[] = [];
let mockPagination: { total: number; totalPages: number } | null = null;
let mockError: Error | null = null;
let mockPlaceholder = false;
jest.mock("@/hooks/use-monitor-details", () => ({
  useMonitorStats: () => ({ stats: null }),
  useMonitorResults: (_id: string, options: ResultsOptions) => {
    resultsCalls.push(options);
    return { results: mockResults, pagination: mockPagination, isFetching: false, isPlaceholderData: mockPlaceholder, error: mockError };
  },
  useMonitorPermissions: () => ({ canEdit: true, canDelete: true, canToggle: true, isLoading: false }),
}));
jest.mock("@/components/shared/report-viewer", () => ({ ReportViewer: () => null }));
jest.mock("@/components/monitors/ai-monitor-analyze-button", () => ({ AIMonitorAnalyzeButton: () => null }));
jest.mock("@/components/monitors/response-time-line-chart", () => ({ ResponseTimeBarChart: () => null }));
jest.mock("./AvailabilityBarChart", () => ({
  AvailabilityBarChart: ({ headerActions }: { headerActions?: React.ReactNode }) => <>{headerActions}</>,
}));
jest.mock("./location-filter-dropdown", () => ({
  LocationFilterDropdown: ({ selectedLocation, onLocationChange }: { selectedLocation: string; onLocationChange: (l: string) => void }) => (
    <button type="button" data-testid="location" onClick={() => onLocationChange("old-region")}>{selectedLocation}</button>
  ),
}));
jest.mock("@/components/nav-user", () => ({ NavUser: () => null }));

const baseMonitor = {
  id: "m1",
  name: "Site",
  type: "website",
  target: "https://example.test",
  status: "up",
  frequencyMinutes: 5,
  createdAt: "2026-11-10T09:00:00.000Z",
  recentResults: [],
};
const renderMonitor = (extra: Record<string, unknown> = {}) =>
  render(<MonitorDetailClient monitor={{ ...baseMonitor, ...extra } as never} />);

const day = (label: RegExp) => screen.getByRole("button", { name: label });
const openCalendar = () => fireEvent.click(screen.getByRole("button", { name: /Filter by date/ }));
const label = (d: Date) => new RegExp(format(d, "MMMM do, yyyy"));
// The first selectable local day holds cleanup's UTC boundary (it depends on the time zone the tests run in).
const firstKept = (days: number) => startOfDay(rawCutoff(days));
const lastCall = () => resultsCalls[resultsCalls.length - 1];
const row = (id: string, isUp: boolean) => ({ id, monitorId: "m1", checkedAt: new Date().toISOString(), isUp, responseTimeMs: 10, location: null, details: null });

beforeEach(() => {
  // Friday 20 November 2026, midday local time.
  jest.useFakeTimers({ now: new Date(2026, 10, 20, 12), advanceTimers: true });
  resultsCalls.length = 0;
  mockResults = [];
  mockPagination = null;
  mockError = null;
  mockPlaceholder = false;
});
afterEach(() => {
  jest.useRealTimers();
});

describe("check results date filter", () => {
  it("offers only today and the previous 6 days with a 7-day plan window", () => {
    renderMonitor({ resultRetention: { days: 7, onPlan: true } });
    openCalendar();
    expect(day(/November 20th, 2026/)).toBeEnabled();
    // Cleanup keeps rows from 13 November 00:00 UTC: that local day is the first one offered.
    expect(day(label(firstKept(7)))).toBeEnabled();
    expect(day(label(subDays(firstKept(7), 1)))).toBeDisabled();
    expect(day(/November 21st, 2026/)).toBeDisabled();
    expect(screen.getByTestId("results-retention-hint")).toHaveTextContent("Check details are kept for 7 days on your plan.");
    // No month before the window or after today to page to.
    expect(screen.getByRole("button", { name: /previous month/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /next month/i })).toHaveAttribute("aria-disabled", "true");
  });

  it("starts at the local day that holds the cleanup's UTC boundary, in any time zone", () => {
    renderMonitor({ createdAt: "2026-09-01T09:00:00.000Z", resultRetention: { days: 7, onPlan: true } });
    openCalendar();
    expect(day(label(firstKept(7)))).toBeEnabled();
    expect(day(label(subDays(firstKept(7), 1)))).toBeDisabled();
  });

  it("opens the previous month too with a 30-day window", () => {
    renderMonitor({ createdAt: "2026-09-01T09:00:00.000Z", resultRetention: { days: 30, onPlan: true } });
    openCalendar();
    expect(day(/November 1st, 2026/)).toBeEnabled();
    expect(day(/November 21st, 2026/)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));
    expect(day(label(firstKept(30)))).toBeEnabled();
    expect(day(label(subDays(firstKept(30), 1)))).toBeDisabled();
  });

  it("never offers days before the monitor existed", () => {
    renderMonitor({ resultRetention: { days: 30, onPlan: true } });
    openCalendar();
    expect(day(/November 10th, 2026/)).toBeEnabled();
    expect(day(/November 9th, 2026/)).toBeDisabled();
  });

  it("drops the plan wording when billing is off", () => {
    renderMonitor({ resultRetention: { days: 7, onPlan: false } });
    openCalendar();
    expect(screen.getByTestId("results-retention-hint")).toHaveTextContent(/^Check details are kept for 7 days\.$/);
  });

  it("falls back to the monitor's creation day and shows no hint when retention is unknown", () => {
    renderMonitor();
    openCalendar();
    expect(day(/November 10th, 2026/)).toBeEnabled();
    expect(day(/November 9th, 2026/)).toBeDisabled();
    expect(screen.queryByTestId("results-retention-hint")).toBeNull();
  });
});

describe("failures-only toggle", () => {
  it("asks for failed checks, resets to page 1 and says so in the description", () => {
    mockResults = [row("a", false)];
    mockPagination = { total: 25, totalPages: 3 };
    renderMonitor({ resultRetention: { days: 7, onPlan: true } });
    expect(lastCall().failuresOnly).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(lastCall().page).toBe(2);

    fireEvent.click(screen.getByRole("switch", { name: "Failures only" }));
    expect(lastCall()).toEqual(expect.objectContaining({ failuresOnly: true, page: 1 }));
    expect(screen.getByText("Showing 1 of 25 recent failed checks.")).toBeInTheDocument();
  });

  it("resets to page 1 when a date is picked", () => {
    mockResults = [row("a", true)];
    mockPagination = { total: 25, totalPages: 3 };
    renderMonitor({ resultRetention: { days: 7, onPlan: true } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(lastCall().page).toBe(2);
    openCalendar();
    act(() => {
      fireEvent.click(day(/November 18th, 2026/));
    });
    expect(lastCall().page).toBe(1);
    expect(lastCall().date?.getDate()).toBe(18);
  });

  it("explains an empty failures-only window", () => {
    mockPagination = { total: 0, totalPages: 0 };
    renderMonitor({ resultRetention: { days: 30, onPlan: true } });
    fireEvent.click(screen.getByRole("switch", { name: "Failures only" }));
    expect(screen.getByText("No failed checks")).toBeInTheDocument();
    expect(screen.getByText("No check failed in the last 30 days.")).toBeInTheDocument();
  });

  it("explains an empty failures-only day", () => {
    mockPagination = { total: 0, totalPages: 0 };
    renderMonitor({ resultRetention: { days: 7, onPlan: true } });
    fireEvent.click(screen.getByRole("switch", { name: "Failures only" }));
    openCalendar();
    act(() => {
      fireEvent.click(day(/November 18th, 2026/));
    });
    expect(screen.getByText("No failed checks on November 18, 2026.")).toBeInTheDocument();
    expect(screen.getByText("Showing 0 of 0 failed checks for November 18, 2026")).toBeInTheDocument();
  });

  it("explains an empty day without the failures filter", () => {
    mockPagination = { total: 0, totalPages: 0 };
    renderMonitor({ resultRetention: { days: 7, onPlan: true } });
    openCalendar();
    act(() => {
      fireEvent.click(day(/November 18th, 2026/));
    });
    expect(screen.getByText("No checks on this day")).toBeInTheDocument();
  });

  it("says the request failed instead of claiming no failures", () => {
    mockError = new Error("Failed to fetch monitor results: 500");
    renderMonitor({ resultRetention: { days: 7, onPlan: true } });
    fireEvent.click(screen.getByRole("switch", { name: "Failures only" }));
    expect(screen.getByText("Could not load check results")).toBeInTheDocument();
    expect(screen.queryByText("No failed checks")).toBeNull();
  });

  it("keeps a location with history but no failures selected when failures-only is on", () => {
    // "old-region" is no longer configured: only its rows on the unfiltered page make it selectable.
    mockResults = [{ ...row("a", true), location: "old-region" }];
    mockPagination = { total: 1, totalPages: 1 };
    const view = renderMonitor({ resultRetention: { days: 7, onPlan: true }, config: { locationConfig: { locations: ["eu-central"] } } });
    fireEvent.click(screen.getByTestId("location"));
    expect(lastCall().location).toBe("old-region");

    mockResults = [];
    mockPagination = { total: 0, totalPages: 0 };
    fireEvent.click(screen.getByRole("switch", { name: "Failures only" }));
    view.rerender(<MonitorDetailClient monitor={{ ...baseMonitor, resultRetention: { days: 7, onPlan: true }, config: { locationConfig: { locations: ["eu-central"] } } } as never} />);
    expect(lastCall()).toEqual(expect.objectContaining({ location: "old-region", failuresOnly: true }));
  });
});

describe("heartbeat ping history filters", () => {
  const renderHeartbeat = () =>
    renderMonitor({ type: "heartbeat", target: "", resultRetention: { days: 7, onPlan: true } });

  it("offers the same date and failures-only filters as the other monitor types", () => {
    renderHeartbeat();
    fireEvent.click(screen.getByRole("switch", { name: "Failures only" }));
    expect(lastCall()).toEqual(expect.objectContaining({ failuresOnly: true, page: 1 }));
    expect(screen.getByTestId("heartbeat-ping-history-filtered-empty")).toHaveTextContent("No failed or missed pings");
    // The "no pings yet" setup hint only shows without a filter.
    expect(screen.queryByTestId("heartbeat-ping-history-empty")).toBeNull();
    openCalendar();
    expect(screen.getByTestId("results-retention-hint")).toBeInTheDocument();
  });

  it("names filtered pings in the summary", () => {
    mockResults = [{ ...row("a", false), status: "missed" }];
    mockPagination = { total: 3, totalPages: 1 };
    renderHeartbeat();
    fireEvent.click(screen.getByRole("switch", { name: "Failures only" }));
    expect(screen.getByText("Showing 1 of 3 failed or missed pings.")).toBeInTheDocument();
  });

  it("uses the singular for one filtered ping", () => {
    mockResults = [{ ...row("a", false), status: "missed" }];
    mockPagination = { total: 1, totalPages: 1 };
    renderHeartbeat();
    fireEvent.click(screen.getByRole("switch", { name: "Failures only" }));
    expect(screen.getByText("Showing 1 of 1 failed or missed ping.")).toBeInTheDocument();
  });

  it("names the day in the date-filtered empty states", () => {
    renderHeartbeat();
    openCalendar();
    act(() => {
      fireEvent.click(day(/November 18th, 2026/));
    });
    expect(screen.getByText("No pings on this day")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Failures only" }));
    expect(screen.getByText("No failed or missed pings on November 18, 2026.")).toBeInTheDocument();
  });

  it("shows the skeleton, not stale rows under the new filter, while a filtered page loads", () => {
    mockResults = [row("a", true)];
    mockPagination = { total: 50, totalPages: 5 };
    mockPlaceholder = true;
    renderHeartbeat();
    expect(screen.getByLabelText("Loading ping history")).toBeInTheDocument();
    expect(screen.queryByText(/Showing 1 of 50/)).toBeNull();
  });
});
