import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MaintenanceWindowsPanel, MonitorMaintenanceBar, ServiceMaintenanceAction } from "./maintenance-windows-panel";

const mockReplace = jest.fn();
let mockSearch = "";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => "/monitors",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
const mockInvalidate = jest.fn();
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
let mockRole = "project_editor";
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ projectId: "p-1", currentProject: { userRole: mockRole } }) }));
let mockWindows: { data?: unknown[]; isLoading?: boolean; error?: Error | null; refetch?: () => void } = {};
const mockAction = jest.fn();
jest.mock("@/hooks/use-maintenance-windows", () => ({
  MAINTENANCE_QUERY_KEY: ["maintenance-windows"],
  useMaintenanceWindows: () => mockWindows,
  windowAction: (...a: unknown[]) => mockAction(...a),
}));
jest.mock("./maintenance-window-dialog", () => ({
  MaintenanceWindowDialog: ({ defaults }: { defaults?: { monitorId?: string; serviceId?: string } }) => <div role="dialog" data-defaults={JSON.stringify(defaults ?? {})} />,
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const win = (extra: Record<string, unknown>) => ({
  id: "w-1", title: "DB upgrade", description: null, state: "active", scope: "monitors", recurrence: "once", timezone: "UTC",
  occurrenceStartsAt: "2026-11-20T01:00:00Z", occurrenceEndsAt: "2026-11-20T02:30:00Z", targets: [{ type: "monitor", id: "m-1" }], statusPageIncidentIds: [], ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "project_editor";
  mockSearch = "";
  mockAction.mockResolvedValue(undefined);
});

describe("MaintenanceWindowsPanel", () => {
  it("shows loading, error and empty states", () => {
    mockWindows = { isLoading: true };
    const { rerender } = render(<MaintenanceWindowsPanel />);
    expect(screen.getByLabelText("Loading maintenance windows")).toBeInTheDocument();
    const refetch = jest.fn();
    mockWindows = { error: new Error("x"), refetch };
    rerender(<MaintenanceWindowsPanel />);
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    mockWindows = { data: [] };
    rerender(<MaintenanceWindowsPanel />);
    expect(screen.getByText("No maintenance scheduled")).toBeInTheDocument();
  });

  it("groups windows and offers end and extend for an active one", async () => {
    mockWindows = { data: [win({}), win({ id: "w-2", title: "Next", state: "scheduled" }), win({ id: "w-3", title: "Old", state: "completed" })] };
    render(<MaintenanceWindowsPanel />);
    expect(screen.getByRole("heading", { name: "Active" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upcoming" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Past" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End now" }));
    await waitFor(() => expect(mockAction).toHaveBeenCalledWith("w-1", "end", undefined));
    await waitFor(() => expect(screen.getByRole("button", { name: "Extend 30 min" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Extend 30 min" }));
    await waitFor(() => expect(mockAction).toHaveBeenCalledWith("w-1", "extend", { byMinutes: 30 }));
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it("confirms before cancelling", async () => {
    mockWindows = { data: [win({ state: "scheduled" })] };
    render(<MaintenanceWindowsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel window" }));
    await waitFor(() => expect(mockAction).toHaveBeenCalledWith("w-1", "cancel", undefined));
  });

  it("hides write actions from viewers and delete from editors", () => {
    mockWindows = { data: [win({ state: "scheduled" })] };
    const { unmount } = render(<MaintenanceWindowsPanel />);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    unmount();
    mockRole = "project_viewer";
    render(<MaintenanceWindowsPanel />);
    expect(screen.queryByRole("button", { name: /schedule maintenance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("opens the editor from ?new=1 and clears it on close", () => {
    mockWindows = { data: [] };
    mockSearch = "tab=maintenance&new=1";
    render(<MaintenanceWindowsPanel />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("monitor and service actions", () => {
  it("shows the banner while a window covers the monitor and prefills the editor", () => {
    mockWindows = { data: [win({})] };
    render(<MonitorMaintenanceBar monitorId="m-1" />);
    expect(screen.getByTestId("maintenance-banner")).toHaveTextContent("In maintenance until");
    fireEvent.click(screen.getByRole("button", { name: /schedule maintenance/i }));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-defaults", JSON.stringify({ monitorId: "m-1" }));
  });

  it("shows the latest end when overlapping windows cover the monitor", () => {
    const end = (h: number) => new Date(Date.UTC(2026, 10, 20, h, 0)).toISOString();
    mockWindows = { data: [win({ id: "w-1", occurrenceEndsAt: end(11) }), win({ id: "w-2", occurrenceEndsAt: end(13) })] };
    render(<MonitorMaintenanceBar monitorId="m-1" />);
    const latest = new Date(end(13)).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    expect(screen.getByTestId("maintenance-banner")).toHaveTextContent(`In maintenance until ${latest}`);
  });

  it("renders nothing for a viewer when no window is active", () => {
    mockRole = "project_viewer";
    mockWindows = { data: [] };
    const { container } = render(<><MonitorMaintenanceBar monitorId="m-1" /><ServiceMaintenanceAction serviceId="s-1" /></>);
    expect(container).toBeEmptyDOMElement();
  });
});
