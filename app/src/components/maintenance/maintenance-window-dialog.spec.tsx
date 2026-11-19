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
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Time zone" }));
    fireEvent.click(screen.getByRole("option", { name: "Europe/Berlin" }));
    expect(screen.getByTestId("mw-preview-time")).toHaveTextContent(/20.*2026.*2:00.*3:30.*\(Europe\/Berlin\), 1 h 30 min/i);
    expect(screen.getByTestId("mw-mute-preview")).toHaveTextContent("API");
    fireEvent.click(screen.getByRole("button", { name: "Schedule maintenance" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/maintenance-windows");
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({
      title: "DB upgrade", scope: "monitors", targets: { serviceIds: [], monitorIds: ["m-1"] }, recurrence: "once",
      timezone: "Europe/Berlin", localStartTime: "02:00", durationMinutes: 90, startsOn: "2026-11-20", statusPages: [], notifySubscribers: false,
    });
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["monitors"] });
  });

  it("notes a DST change inside the previewed window", () => {
    render(<MaintenanceWindowDialog open onOpenChange={jest.fn()} defaults={{ monitorId: "m-1" }} />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2027-03-14" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "01:30" } });
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Time zone" }));
    fireEvent.click(screen.getByRole("option", { name: "America/New_York" }));
    expect(screen.getByRole("status")).toHaveTextContent(/go forward 1 h/);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2027-03-20" } });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
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

  it("says why the button is disabled", () => {
    render(<MaintenanceWindowDialog open onOpenChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Schedule maintenance" })).toHaveAccessibleDescription("Add a title.");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "x" } });
    expect(screen.getByText("Choose at least one monitor.")).toBeInTheDocument();
  });

  it("previews every project monitor for a whole-project window", () => {
    render(<MaintenanceWindowDialog open onOpenChange={jest.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Covers" }));
    fireEvent.click(screen.getByRole("option", { name: "Every monitor in this project" }));
    expect(screen.getByTestId("mw-mute-preview")).toHaveTextContent("All 1 monitor in this project");
  });

  const stored = {
    id: "w-9", title: "DB upgrade", description: null, state: "scheduled" as const, scope: "monitors" as const, recurrence: "once" as const,
    timezone: "UTC", localStartTime: "22:00:00", durationMinutes: 240, startsOn: "2026-11-20", endsOn: null, weekdays: null, monthDay: null,
    occurrenceStartsAt: "2099-11-20T22:00:00Z", occurrenceEndsAt: "2099-11-21T02:00:00Z", targets: [{ type: "monitor" as const, id: "m-1" }], statusPageIncidentIds: [],
  };

  it("edits a scheduled window with a PATCH and no status page fields", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, window: { id: "w-9" } }) });
    const onOpenChange = jest.fn();
    render(<MaintenanceWindowDialog open onOpenChange={onOpenChange} window={stored} />);
    expect(screen.getByLabelText("Title")).toHaveValue("DB upgrade");
    expect(screen.queryByRole("switch", { name: "Show on a status page" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/maintenance-windows/w-9");
    expect((init as { method: string }).method).toBe("PATCH");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toMatchObject({ title: "DB upgrade", recurrence: "once", localStartTime: "22:00", durationMinutes: 300, startsOn: "2026-11-20" });
    expect(body).not.toHaveProperty("targets");
    expect(body).not.toHaveProperty("statusPages");
    expect(body).not.toHaveProperty("notifySubscribers");
  });

  it("locks the schedule of a one-off window in progress and sends no schedule keys", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, window: { id: "w-9" } }) });
    render(<MaintenanceWindowDialog open onOpenChange={jest.fn()} window={{ ...stored, state: "active" }} />);
    expect(screen.getByLabelText("Duration (minutes)")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Time zone" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "DB upgrade, phase 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.title).toBe("DB upgrade, phase 2");
    for (const key of ["recurrence", "timezone", "localStartTime", "durationMinutes", "startsOn", "endsOn", "weekdays", "monthDay"]) expect(body).not.toHaveProperty(key);
  });

  it("does not resend unchanged targets, so a deleted monitor never blocks a title edit", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, window: { id: "w-9" } }) });
    render(<MaintenanceWindowDialog open onOpenChange={jest.fn()} window={{ ...stored, targets: [{ type: "monitor" as const, id: "m-1" }, { type: "monitor" as const, id: "m-deleted" }] }} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body).not.toHaveProperty("targets");
    expect(body).not.toHaveProperty("scope");
  });

  it("keeps a status page window one-off but still sends its other schedule fields", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, window: { id: "w-9" } }) });
    render(<MaintenanceWindowDialog open onOpenChange={jest.fn()} window={{ ...stored, statusPageIncidentIds: ["i-1"] }} />);
    expect(screen.getByRole("combobox", { name: "Repeats" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body).not.toHaveProperty("recurrence");
    expect(body).toMatchObject({ durationMinutes: 240, weekdays: null, monthDay: null });
  });

  it("locks the schedule of a one-off that started while the dialog was open", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, window: { id: "w-9" } }) });
    render(<MaintenanceWindowDialog open onOpenChange={jest.fn()} window={{ ...stored, state: "scheduled", occurrenceStartsAt: new Date(Date.now() - 60_000).toISOString() }} />);
    expect(screen.getByLabelText("Duration (minutes)")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).not.toHaveProperty("durationMinutes");
  });
});
