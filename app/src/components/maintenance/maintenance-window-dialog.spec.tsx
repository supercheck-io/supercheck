import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MaintenanceWindowDialog } from "./maintenance-window-dialog";

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = jest.fn();
});
jest.mock("@/actions/sre-services", () => ({ getSreServices: jest.fn() }));
const mockInvalidate = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { services: [{ id: "s-1", name: "Checkout", status: "active" }] } }),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ projectId: "p-1", currentProject: { userRole: "project_editor" } }) }));
jest.mock("@/hooks/use-all-monitors", () => ({ useAllMonitors: () => ({ data: [{ id: "m-1", name: "API" }], isLoading: false, error: null }) }));
jest.mock("@/hooks/use-status-pages", () => ({
  useStatusPages: () => ({ statusPages: [{ id: "sp-1", name: "Public" }], loading: false }),
  useStatusPageDetail: () => ({ components: [{ id: "c-1", name: "API" }], isLoading: false }),
}));
const mockToast = { success: jest.fn(), error: jest.fn(), warning: jest.fn() };
jest.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => mockToast.success(...a), error: (...a: unknown[]) => mockToast.error(...a), warning: (...a: unknown[]) => mockToast.warning(...a) } }));

const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as never;
});

describe("MaintenanceWindowDialog", () => {
  it("posts a one-off window for the prefilled monitor", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, window: { id: "w-1" } }) });
    const onOpenChange = jest.fn();
    render(<MaintenanceWindowDialog open onOpenChange={onOpenChange} defaults={{ monitorId: "m-1" }} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "DB upgrade" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "02:00" } });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Europe/Berlin" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule maintenance" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/maintenance-windows");
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({
      title: "DB upgrade", scope: "monitors", targets: { serviceIds: [], monitorIds: ["m-1"] }, recurrence: "once",
      timezone: "Europe/Berlin", localStartTime: "02:00", durationMinutes: 90, startsOn: "2026-11-20", statusPages: [], notifySubscribers: false,
    });
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it("shows server field errors next to the fields and stays open", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Choose a valid time zone", fieldErrors: { timezone: "Choose a valid time zone", durationMinutes: "Duration must be between 5 minutes and 7 days" } }) });
    const onOpenChange = jest.fn();
    render(<MaintenanceWindowDialog open onOpenChange={onOpenChange} defaults={{ monitorId: "m-1" }} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule maintenance" }));
    expect(await screen.findByText("Duration must be between 5 minutes and 7 days")).toBeInTheDocument();
    expect(screen.getByLabelText("Time zone")).toHaveAttribute("aria-describedby", "mw-timezone-error");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps the draft when the server cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    render(<MaintenanceWindowDialog open onOpenChange={jest.fn()} defaults={{ serviceId: "s-1" }} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule maintenance" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringMatching(/draft is kept/)));
    expect(screen.getByLabelText("Title")).toHaveValue("x");
  });

  it("requires weekdays for a weekly window", () => {
    render(<MaintenanceWindowDialog open onOpenChange={jest.fn()} defaults={{ monitorId: "m-1" }} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Repeats" }));
    fireEvent.click(screen.getByRole("option", { name: "Weekly" }));
    expect(screen.getByRole("button", { name: "Schedule maintenance" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Mon" }));
    expect(screen.getByRole("button", { name: "Schedule maintenance" })).toBeEnabled();
  });

  it("does not let hidden status page fields block a recurring window", () => {
    render(<MaintenanceWindowDialog open onOpenChange={jest.fn()} defaults={{ monitorId: "m-1" }} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("switch", { name: "Show on a status page" }));
    expect(screen.getByRole("button", { name: "Schedule maintenance" })).toBeDisabled();
    fireEvent.click(screen.getByRole("combobox", { name: "Repeats" }));
    fireEvent.click(screen.getByRole("option", { name: "Daily" }));
    expect(screen.getByRole("button", { name: "Schedule maintenance" })).toBeEnabled();
  });
});
