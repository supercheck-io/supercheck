import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpendingCapBanner } from "./spending-cap-banner";

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
});
