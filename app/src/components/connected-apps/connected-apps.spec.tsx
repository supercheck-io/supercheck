import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const toastSuccess = jest.fn();
const toastError = jest.fn();
jest.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { ConnectedApps } from "./connected-apps";

const fetchMock = jest.fn();
const connection = {
  id: "c-1",
  clientName: "Agent Co",
  verifiedHost: "agent.example.com",
  redirectHosts: ["agent.example.com"],
  projectName: "Alpha",
  connectedAt: "2026-10-01T10:00:00.000Z",
  lastActiveAt: null,
};
const unverified = { ...connection, id: "c-2", clientName: "Local Agent", verifiedHost: null, redirectHosts: ["127.0.0.1:9000"], projectName: null };

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("ConnectedApps", () => {
  it("lists connections with who published them and what they can read", async () => {
    fetchMock.mockResolvedValue(json(200, { connections: [connection, unverified] }));
    render(<ConnectedApps />);
    expect(await screen.findByText("Agent Co")).toBeInTheDocument();
    expect(screen.getByText("Published by agent.example.com")).toBeInTheDocument();
    expect(screen.getByText(/unverified \(returns to 127\.0\.0\.1:9000\)/i)).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("a project you can no longer access")).toBeInTheDocument();
    expect(screen.getAllByText(/last refreshed never/i)).toHaveLength(2);
  });

  it("explains an empty list, a disabled server and a load failure", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { connections: [] }));
    const { unmount } = render(<ConnectedApps />);
    expect(await screen.findByText(/no apps are connected/i)).toBeInTheDocument();
    unmount();

    fetchMock.mockResolvedValueOnce(json(404, { error: "not_found" }));
    const second = render(<ConnectedApps />);
    expect(await screen.findByText(/not enabled on this server/i)).toBeInTheDocument();
    second.unmount();

    fetchMock.mockResolvedValueOnce(json(500, {}));
    render(<ConnectedApps />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
    fetchMock.mockResolvedValueOnce(json(200, { connections: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/no apps are connected/i)).toBeInTheDocument();
  });

  it("asks before disconnecting, then removes exactly that connection and reloads", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { connections: [connection] }))
      .mockResolvedValueOnce(json(200, { success: true }))
      .mockResolvedValueOnce(json(200, { connections: [] }));
    render(<ConnectedApps />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/disconnect agent co\?/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/stop getting access to alpha/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Disconnected Agent Co"));
    expect(fetchMock.mock.calls[1]).toEqual(["/api/oauth/mcp/connections/c-1", { method: "DELETE" }]);
    expect(await screen.findByText(/no apps are connected/i)).toBeInTheDocument();
  });

  it("keeps the connection listed and says so when disconnecting fails", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { connections: [connection] }))
      .mockResolvedValueOnce(json(500, {}));
    render(<ConnectedApps />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not disconnect. Try again."));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("Agent Co")).toBeInTheDocument();
  });

  it("does nothing when the dialog is cancelled", async () => {
    fetchMock.mockResolvedValue(json(200, { connections: [connection] }));
    render(<ConnectedApps />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
