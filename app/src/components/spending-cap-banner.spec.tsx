import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { BILLING_SETTINGS_SAVED_EVENT, SpendingCapBanner } from "./spending-cap-banner";

let mockIdle = true;
jest.mock("@/hooks/use-idle", () => ({ useIdle: () => mockIdle }));

const renderBanner = (enabled: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SpendingCapBanner enabled={enabled} />
    </QueryClientProvider>,
  );

describe("SpendingCapBanner", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("says what is paused when the hard-stop cap is reached", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ spending: { limitEnabled: true, hardStopEnabled: true, isAtLimit: true } }),
    });
    renderBanner(true);
    expect(await screen.findByRole("status")).toHaveTextContent("HTTP, website, ping and port monitors keep running");
  });

  it("stays hidden below the cap, with a soft cap, and for non-admins", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ spending: { limitEnabled: true, hardStopEnabled: false, isAtLimit: true } }),
    });
    global.fetch = fetchMock;
    renderBanner(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fetchMock.mockClear();
    renderBanner(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears as soon as the cap is raised", async () => {
    const spending = { limitEnabled: true, hardStopEnabled: true, isAtLimit: true };
    global.fetch = jest.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ spending: { ...spending } }) }));
    renderBanner(true);
    expect(await screen.findByRole("status")).toBeInTheDocument();
    spending.isAtLimit = false;
    act(() => { window.dispatchEvent(new Event(BILLING_SETTINGS_SAVED_EVENT)); });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("keeps the banner when a later check fails instead of treating the failure as no cap", async () => {
    const client = new QueryClient();
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ spending: { limitEnabled: true, hardStopEnabled: true, isAtLimit: true } }),
    });
    global.fetch = fetchMock;
    render(
      <QueryClientProvider client={client}>
        <SpendingCapBanner enabled />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("status")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    act(() => { window.dispatchEvent(new Event(BILLING_SETTINGS_SAVED_EVENT)); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.getQueryState(["billing-usage", "spending-cap-banner"])?.fetchStatus).toBe("idle"));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("waits for the browser to be idle before asking", async () => {
    mockIdle = false;
    global.fetch = jest.fn();
    renderBanner(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(global.fetch).not.toHaveBeenCalled();
    mockIdle = true;
  });
});
