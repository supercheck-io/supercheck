/**
 * @jest-environment jsdom
 */
import { renderToString } from "react-dom/server";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MONITOR_RESULTS_KEY, MONITOR_STATS_KEY, useMonitorResults, useMonitorStats } from "./use-monitor-details";

function Probe() {
  const { stats } = useMonitorStats("m1");
  return <span data-testid="stats">{stats ? "has-stats" : "no-stats"}</span>;
}

function seededClient() {
  const client = new QueryClient();
  // A restored browser cache: stats already there before the component hydrates.
  client.setQueryData([...MONITOR_STATS_KEY, "m1", "all"], { period24h: {}, period30d: {} });
  return client;
}

describe("useMonitorStats hydration", () => {
  it("renders no stats in the server HTML even when the cache has them, so hydration matches", () => {
    const html = renderToString(
      <QueryClientProvider client={seededClient()}>
        <Probe />
      </QueryClientProvider>,
    );
    expect(html).toContain("no-stats");
  });

  it("shows the cached stats once mounted on the client", () => {
    render(
      <QueryClientProvider client={seededClient()}>
        <Probe />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("stats")).toHaveTextContent("has-stats");
  });
});

describe("useMonitorResults page size change", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const response = (rows: number) => ({
    ok: true,
    json: async () => ({ data: Array.from({ length: rows }, (_, i) => ({ id: `r${i}` })), pagination: { total: rows } }),
  });

  it("refetches a page size whose cached rows are only seconds old (the table refits after mount)", async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(1));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new QueryClient();
    // Cached by an earlier visit 5 s ago, before the first ping: empty.
    client.setQueryData([...MONITOR_RESULTS_KEY, "m1", 1, 7, undefined, "all"], { data: [], pagination: { total: 0 } });
    function Rows({ limit }: { limit: number }) {
      const { results } = useMonitorResults("m1", { page: 1, limit, location: "all" });
      return <span data-testid="rows">{results.length}</span>;
    }
    const tree = (limit: number) => (
      <QueryClientProvider client={client}>
        <Rows limit={limit} />
      </QueryClientProvider>
    );
    const { rerender } = render(tree(10));
    await waitFor(() => expect(screen.getByTestId("rows")).toHaveTextContent("1"));
    rerender(tree(7));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("limit=7")));
    await waitFor(() => expect(screen.getByTestId("rows")).toHaveTextContent("1"));
  });
});
