import { act, fireEvent, render, screen } from "@testing-library/react";
const mockPush = jest.fn();
const mockRefresh = jest.fn();
let mockOrganizationId: string | null = "org-oldest";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => ({ get: (key: string) => key === "organization_id" ? mockOrganizationId : null }),
}));
import BillingSuccessPage from "./page";

describe("single organization checkout return", () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockOrganizationId = "org-oldest";
    mockFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ organizationId: "org-oldest", isActive: true, plan: "plus" }) });
    global.fetch = mockFetch;
  });
  afterEach(() => { jest.useRealTimers(); global.fetch = originalFetch; });
  async function verify() {
    render(<BillingSuccessPage />);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  }
  it.each(["plus", "pro"])("opens the dashboard for verified %s without switching organizations", async plan => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ organizationId: "org-oldest", isActive: true, plan }) });
    await verify();
    fireEvent.click(screen.getByRole("button", { name: /Go to Dashboard/ }));
    await act(async () => {});
    expect(mockPush).toHaveBeenCalledWith("/");
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockFetch.mock.calls.every(([url]) => url === "/api/subscription/status")).toBe(true);
  });
  it("rejects an old checkout for a different organization", async () => {
    mockOrganizationId = "org-newer";
    await verify();
    expect(screen.getByRole("alert")).toHaveTextContent("different organization");
    expect(screen.getByRole("button", { name: /Retry Verification/ })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("project selector");
    expect(screen.getByText("Confirmation Needed")).toBeInTheDocument();
    await act(async () => { await jest.advanceTimersByTimeAsync(90000); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Return to projects/ }));
    expect(mockPush).toHaveBeenCalledWith("/");
  });
  it.each([
    { isActive: false, plan: "plus" },
    { isActive: false, plan: null },
    { isActive: true, plan: "unlimited" },
  ])("waits for actual paid access: %j", async status => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ organizationId: "org-oldest", ...status }) });
    await verify();
    expect(screen.getByRole("button", { name: /Confirming/ })).toBeDisabled();
    expect(mockPush).not.toHaveBeenCalled();
  });
  it("rechecks subscription access before navigation", async () => {
    await verify();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ organizationId: "org-oldest", isActive: false, plan: "plus" }) });
    fireEvent.click(screen.getByRole("button", { name: /Go to Dashboard/ }));
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("still being confirmed");
    expect(mockPush).not.toHaveBeenCalled();
  });
  it("handles a provider/webhook delay and recovers through polling", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    await verify();
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("button", { name: /Go to Dashboard/ })).toBeEnabled();
  });
  it("bounds automatic polling and lets a delayed webhook recover by retry", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ organizationId: "org-oldest", isActive: false, plan: null }) });
    await verify();
    await act(async () => { await jest.advanceTimersByTimeAsync(90000); });
    expect(mockFetch).toHaveBeenCalledTimes(30);
    expect(screen.queryByText("Subscription Activated!")).not.toBeInTheDocument();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ organizationId: "org-oldest", isActive: true, plan: "plus" }) });
    fireEvent.click(screen.getByRole("button", { name: /Retry Verification/ }));
    await act(async () => {});
    expect(screen.getByText("Subscription Activated!")).toBeInTheDocument();
  });

});
