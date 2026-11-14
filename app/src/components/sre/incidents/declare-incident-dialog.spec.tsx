import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createManualSreIncident } from "@/actions/sre-incidents";
import { DeclareIncidentDialog } from "./declare-incident-dialog";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = jest.fn();
});

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/actions/sre-incidents", () => ({ createManualSreIncident: jest.fn() }));
jest.mock("@/actions/sre-services", () => ({ getSreServices: jest.fn() }));
jest.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "monitors"
      ? { data: [{ id: "m-1", name: "Checkout monitor" }], isLoading: false, error: null }
      : { data: { services: [{ id: "svc-1", name: "Checkout API", status: "active" }] } },
  useQueryClient: () => ({ invalidateQueries: jest.fn().mockResolvedValue(undefined) }),
}));
let mockRole = "project_editor";
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ projectId: "p-1", currentProject: { userRole: mockRole } }),
}));
jest.mock("@/hooks/use-sre", () => ({ useSreIncidentAssignees: () => ({ data: { assignees: [{ id: "u-2", name: "Priya", image: null }] } }) }));
jest.mock("@/hooks/use-status-pages", () => ({
  useStatusPages: () => ({ statusPages: [{ id: "sp-1", name: "Public" }], loading: false }),
  useStatusPageDetail: () => ({ components: [{ id: "c-1", name: "API" }], isLoading: false, error: null }),
}));
const mockToast = { success: jest.fn(), error: jest.fn(), warning: jest.fn() };
jest.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => mockToast.success(...a), error: (...a: unknown[]) => mockToast.error(...a), warning: (...a: unknown[]) => mockToast.warning(...a) } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "project_editor";
});

describe("DeclareIncidentDialog", () => {
  it("submits the title, severity and the prefilled monitor, then opens the incident", async () => {
    jest.mocked(createManualSreIncident).mockResolvedValue({ success: true, incident: { id: "i-1", incidentNumber: 5, title: "Down" }, message: "Incident #5 created" });
    render(<DeclareIncidentDialog open onOpenChange={jest.fn()} defaults={{ monitorId: "m-1" }} />);
    expect(screen.getByRole("combobox", { name: /affected monitors/i })).toHaveTextContent("Checkout monitor");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Down  " } });
    fireEvent.click(screen.getByRole("button", { name: "Declare incident" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/incidents/i-1"));
    expect(createManualSreIncident).toHaveBeenCalledWith(expect.objectContaining({
      title: "Down", severity: "sev3", primaryServiceId: null, affected: { monitorIds: ["m-1"] }, commanderUserId: null, statusPage: null,
    }));
    expect(mockToast.success).toHaveBeenCalledWith("Incident #5 created");
  });

  it("requires a page and a component before posting publicly", async () => {
    jest.mocked(createManualSreIncident).mockResolvedValue({ success: true, incident: { id: "i-2", incidentNumber: 6, title: "Down" }, message: "Incident #6 created", warning: "status_page_failed" });
    render(<DeclareIncidentDialog open onOpenChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Down" } });
    fireEvent.click(screen.getByRole("switch", { name: /post to a status page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Declare incident" }));
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringMatching(/status page/));
    expect(createManualSreIncident).not.toHaveBeenCalled();
  });

  it("shows the server's error and stays open", async () => {
    jest.mocked(createManualSreIncident).mockResolvedValue({ success: false, error: "Too many incidents declared. Try again shortly." });
    render(<DeclareIncidentDialog open onOpenChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Down" } });
    fireEvent.click(screen.getByRole("button", { name: "Declare incident" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Too many incidents declared. Try again shortly."));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("hides the status page section from roles that cannot post publicly", () => {
    mockRole = "project_viewer";
    render(<DeclareIncidentDialog open onOpenChange={jest.fn()} />);
    expect(screen.queryByRole("switch", { name: /post to a status page/i })).not.toBeInTheDocument();
  });

  it("posts publicly with the picked page, component, impact, message and notify, then warns if the post failed", async () => {
    jest.mocked(createManualSreIncident).mockResolvedValue({ success: true, incident: { id: "i-3", incidentNumber: 7, title: "Down" }, message: "Incident #7 created", warning: "status_page_failed" });
    render(<DeclareIncidentDialog open onOpenChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Down" } });
    fireEvent.change(screen.getByLabelText("Initial notes"), { target: { value: "Users report 500s" } });
    fireEvent.click(screen.getByRole("switch", { name: /post to a status page/i }));
    fireEvent.click(screen.getByRole("combobox", { name: /status page/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Public" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Public message"), { target: { value: "Investigating" } });
    fireEvent.click(screen.getByRole("switch", { name: /notify subscribers/i }));
    fireEvent.click(screen.getByRole("button", { name: "Declare incident" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/incidents/i-3"));
    expect(createManualSreIncident).toHaveBeenCalledWith(expect.objectContaining({
      summary: "Users report 500s",
      statusPage: { statusPageId: "sp-1", componentIds: ["c-1"], impact: "minor", message: "Investigating", notifySubscribers: true },
    }));
    expect(mockToast.warning).toHaveBeenCalledWith(expect.stringContaining("status page post failed"), expect.objectContaining({ action: expect.objectContaining({ label: "Post to status page" }) }));
  });

  it("toggles monitors in the picker and sends the chosen service and commander", async () => {
    jest.mocked(createManualSreIncident).mockResolvedValue({ success: true, incident: { id: "i-4", incidentNumber: 8, title: "Down" }, message: "Incident #8 created" });
    render(<DeclareIncidentDialog open onOpenChange={jest.fn()} defaults={{ serviceId: "svc-1", monitorId: "m-1" }} />);
    fireEvent.click(screen.getByRole("combobox", { name: /affected monitors/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Checkout monitor/ }));
    expect(screen.getByRole("combobox", { name: /affected monitors/i })).toHaveTextContent("None");
    fireEvent.click(screen.getByRole("combobox", { name: /commander/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Priya" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Down" } });
    fireEvent.click(screen.getByRole("button", { name: "Declare incident" }));
    await waitFor(() => expect(createManualSreIncident).toHaveBeenCalled());
    expect(createManualSreIncident).toHaveBeenCalledWith(expect.objectContaining({ primaryServiceId: "svc-1", commanderUserId: "u-2" }));
    expect(jest.mocked(createManualSreIncident).mock.calls[0]![0]).not.toHaveProperty("affected.monitorIds");
  });

  it("keeps the draft and says so when the request cannot reach the server", async () => {
    jest.mocked(createManualSreIncident).mockRejectedValue(new Error("network"));
    const onOpenChange = jest.fn();
    render(<DeclareIncidentDialog open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Down" } });
    fireEvent.click(screen.getByRole("button", { name: "Declare incident" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringMatching(/draft is kept/)));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Title")).toHaveValue("Down");
  });
});
