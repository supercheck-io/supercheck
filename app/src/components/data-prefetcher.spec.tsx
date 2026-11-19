import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DataPrefetcher } from "./data-prefetcher";

jest.mock("next/navigation", () => ({ usePathname: () => "/tests" }));
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ currentProject: { id: "p1", slug: "p" } }),
}));

describe("DataPrefetcher", () => {
  const fetchMock = jest.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockClear();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => jest.useRealTimers());

  it("holds the next-page prefetch while another query is loading, then runs it", async () => {
    const client = new QueryClient();
    let release: () => void = () => {};
    void client.prefetchQuery({
      queryKey: ["page-data"],
      queryFn: () => new Promise<string>((resolve) => { release = () => resolve("x"); }),
    });
    render(
      <QueryClientProvider client={client}>
        <DataPrefetcher />
      </QueryClientProvider>
    );
    const listCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/runs").length;

    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(listCalls()).toBe(0);

    // Released well before the 4s cap, so only the quiet detection can start it.
    await act(async () => { release(); await Promise.resolve(); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(listCalls()).toBe(1);
  });

  it("does not prefetch after unmounting before the idle callback runs", async () => {
    const client = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <DataPrefetcher />
      </QueryClientProvider>
    );
    await act(async () => { jest.advanceTimersByTime(400); }); // quiet confirmed, run queued
    unmount();
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/runs")).toHaveLength(0);
  });
});
