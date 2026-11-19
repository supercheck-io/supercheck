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

    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(listCalls()).toBe(0);

    // Released well before the 1.5s cap, so only the quiet detection can start it.
    await act(async () => { release(); await Promise.resolve(); });
    // 300ms quiet check + 500ms idle fallback = 800ms, which ends before the cap's own run at 2000ms.
    await act(async () => { jest.advanceTimersByTime(850); });
    expect(listCalls()).toBe(1);
  });

  it("cancels the queued idle callback on unmount", async () => {
    const win = window as unknown as Record<string, unknown>;
    const request = jest.fn((_cb: () => void, _opts?: object) => 42);
    const cancel = jest.fn();
    win.requestIdleCallback = request;
    win.cancelIdleCallback = cancel;
    try {
      const { unmount } = render(
        <QueryClientProvider client={new QueryClient()}>
          <DataPrefetcher />
        </QueryClientProvider>
      );
      // Let the auth prefetches settle so the cache goes quiet.
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(request).toHaveBeenCalledTimes(1);
      unmount();
      expect(cancel).toHaveBeenCalledWith(42);
      expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/runs")).toHaveLength(0);
    } finally {
      delete win.requestIdleCallback;
      delete win.cancelIdleCallback;
    }
  });

  it("is not held by background refetches of queries that already have data", async () => {
    const client = new QueryClient();
    client.setQueryData(["polled"], "old");
    void client.refetchQueries({
      queryKey: ["polled"],
      type: "all",
    });
    client.getQueryCache().find({ queryKey: ["polled"] })!.fetch(undefined, {
      // Never settles: stands in for a polling or retrying refetch.
      fetchFn: () => new Promise(() => {}),
    } as never).catch(() => {});
    render(
      <QueryClientProvider client={client}>
        <DataPrefetcher />
      </QueryClientProvider>
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { jest.advanceTimersByTime(850); });
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/runs")).toHaveLength(1);
  });

  it("keeps its quiet deadline while cached queries keep updating", async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <DataPrefetcher />
      </QueryClientProvider>
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // A poll writing to the cache every 200ms must not keep pushing the batch back to the cap.
    for (let t = 0; t < 850; t += 200) {
      client.setQueryData(["polled"], t);
      await act(async () => { jest.advanceTimersByTime(200); });
    }
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/runs")).toHaveLength(1);
  });
});
