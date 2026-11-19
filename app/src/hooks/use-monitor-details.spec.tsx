/**
 * @jest-environment jsdom
 */
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MONITOR_STATS_KEY, useMonitorStats } from "./use-monitor-details";

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
