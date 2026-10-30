import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { OpenIncidentCell, isEscalatableAlert } from "./open-incident-cell";
import type { AlertHistory } from "./schema";

const push = jest.fn();
const createIncident = jest.fn();
let role: string | null = "project_editor";
const invalidateQueries = jest.fn(async () => undefined);
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/actions/sre-incidents", () => ({
  createSreIncidentFromAlert: (...args: unknown[]) => createIncident(...args),
}));
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ currentProject: role ? { userRole: role } : null, projectId: "p1", loading: false, error: null }),
}));

const alert = (overrides: Partial<AlertHistory>) =>
  ({ id: "a1", type: "monitor_failure", status: "sent", message: "Down", ...overrides }) as AlertHistory;

beforeEach(() => {
  jest.clearAllMocks();
  role = "project_editor";
});

describe("isEscalatableAlert", () => {
  it.each([
    [{}, true],
    [{ status: "failed" }, false],
    [{ type: "monitor_recovery" }, false],
    [{ type: "job_success" }, false],
    [{ type: "job_failed", message: "Job completed successfully" }, true],
  ])("%j -> %s", (overrides, expected) => {
    expect(isEscalatableAlert(alert(overrides as Partial<AlertHistory>))).toBe(expected);
  });
});

describe("OpenIncidentCell", () => {
  it("opens an incident from the alert and navigates to it", async () => {
    createIncident.mockResolvedValue({ success: true, message: "Opened", incident: { id: "inc-1" } });
    render(<OpenIncidentCell alertHistoryId="a1" targetName="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Open incident for api" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/incidents/inc-1"));
    expect(createIncident).toHaveBeenCalledWith({ alertHistoryId: "a1" });
    // The incident list must not show a stale cache when the user goes back to it.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: expect.arrayContaining(["p1"]) });
  });

  it("stays on the page when the action fails", async () => {
    createIncident.mockResolvedValue({ success: false, error: "Nope" });
    render(<OpenIncidentCell alertHistoryId="a1" targetName="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Open incident for api" }));
    await waitFor(() => expect(createIncident).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a toast and stays put when the request throws, and disables the button while pending", async () => {
    let reject: (reason: unknown) => void = () => {};
    createIncident.mockReturnValue(new Promise((_, r) => { reject = r; }));
    render(<OpenIncidentCell alertHistoryId="a1" targetName="api" />);
    const button = screen.getByRole("button", { name: "Open incident for api" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    reject(new Error("network"));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(jest.requireMock("sonner").toast.error).toHaveBeenCalledWith("Could not open the incident. Please try again.");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows no action to users who cannot create incidents", () => {
    role = "project_viewer";
    render(<OpenIncidentCell alertHistoryId="a1" targetName="api" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
