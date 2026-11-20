import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetchDashboard, getDashboardQueryKey, parseSystemHealth, useDashboard, type DashboardData } from "./use-dashboard";

jest.mock("./use-project-context", () => ({ useProjectContext: () => ({ currentProject: { id: "project-a" } }) }));

describe("dashboard data contract", () => {
  afterEach(() => jest.restoreAllMocks());

  it("keeps today's trend buckets and the 7-day failures by trigger", async () => {
    const trend = Array.from({ length: 31 }, (_, i) => ({ date: String(i), uptime: 100, count: i }));
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        monitors: { availabilityTrend: trend },
        tests: { playgroundExecutionsTrend: trend },
        jobs: {
          triggerTrend: trend.map(({ date }) => ({ date, manual: 1, scheduled: 2, remote: 3 })),
          failedRuns7d: { manual: 4, scheduled: 2, remote: -1 },
        },
      }),
    } as Response);
    const data = await fetchDashboard();
    expect(data.monitors.availabilityTrend?.at(-1)?.date).toBe("30");
    expect(data.tests.playgroundExecutionsTrend.at(-1)?.date).toBe("30");
    expect(data.jobs.triggerTrend).toHaveLength(30);
    expect(data.jobs.triggerTrend.at(-1)).toEqual({ date: "30", manual: 1, scheduled: 2, remote: 3 });
    expect(data.jobs.failedRuns7d).toEqual({ manual: 4, scheduled: 2, remote: 0 });
  });

  it("defaults missing blocks to empty values without calling the alerts endpoint", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValue({ ok: true, json: async () => ({ jobs: { recentRuns30d: 8 } }) } as Response);
    const data = await fetchDashboard("project-a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data.stats.runs).toBe(8);
    expect(data.jobs.failedRuns7d).toEqual({ manual: 0, scheduled: 0, remote: 0 });
    expect(data.jobs.triggerTrend).toEqual([]);
    expect(data.tests.playgroundExecutionsTrend).toEqual([]);
  });

  it("keeps null uptime and 0 ms response times instead of coercing them", async () => {
    const respond = (monitors: unknown) => jest.spyOn(global, "fetch")
      .mockResolvedValue({ ok: true, json: async () => ({ monitors }) } as Response);
    respond({ uptime: null, responseTime: { avg: 0, min: 0, max: null } });
    let data = await fetchDashboard();
    expect(data.monitors.uptime).toBeNull();
    expect(data.monitors.responseTime).toEqual({ avg: 0, min: 0, max: null });
    jest.restoreAllMocks();
    respond({ uptime: 0 });
    data = await fetchDashboard();
    expect(data.monitors.uptime).toBe(0);
  });

  it("rejects unavailable dashboard data instead of returning a partial dashboard", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 503, statusText: "Unavailable" } as Response);
    await expect(fetchDashboard()).rejects.toThrow("Dashboard API error: 503 Unavailable");
  });

  it("aborts stalled requests and clears the timeout", async () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(global, "fetch").mockImplementation((_url: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }));
      const request = expect(fetchDashboard()).rejects.toThrow("Dashboard request timed out");
      await jest.advanceTimersByTimeAsync(30_000);
      await request;
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });
});

describe("parseSystemHealth", () => {
  it("preserves the server's issues, including queue capacity", () => {
    const health = parseSystemHealth({
      timestamp: "2026-10-25T10:00:00.000Z",
      healthy: true, // untrusted: derived from the issue list instead
      issues: [
        { type: "queue", message: "Execution queue at capacity (5/5 running)", severity: "high" },
        { type: "job", message: "2 job runs failed in the last 24 hours", severity: "medium" },
      ],
    });
    expect(health.healthy).toBe(false);
    expect(health.issues.map((i) => i.type)).toEqual(["queue", "job"]);
    expect(health.timestamp).toBe("2026-10-25T10:00:00.000Z");
  });

  it("is healthy with no issues and tolerates a missing block", () => {
    expect(parseSystemHealth({ issues: [] }).healthy).toBe(true);
    expect(parseSystemHealth(undefined).issues).toEqual([]);
  });
});

describe("useDashboard with a server seed", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  const seed = (projectId: string, updatedAt = Date.now()) => ({
    projectId,
    updatedAt,
    data: { stats: { runs: 3 } } as unknown as DashboardData,
  });
  const run = (s: ReturnType<typeof seed> | null) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    return { client, ...renderHook(() => useDashboard(s), { wrapper }) };
  };

  it("shows the seed for the current project without requesting it", async () => {
    global.fetch = jest.fn();
    const { result } = run(seed("project-a"));
    expect(result.current.data?.stats.runs).toBe(3);
    await new Promise((r) => setTimeout(r, 20));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("ignores a seed for another project and requests the current one", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: { recentRuns30d: 9 } }) });
    const { result } = run(seed("project-b"));
    await waitFor(() => expect(result.current.data?.stats.runs).toBe(9));
  });

  it("refreshes a seed older than a minute", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: { recentRuns30d: 5 } }) });
    const { result } = run(seed("project-a", Date.now() - 2 * 60_000));
    expect(result.current.data?.stats.runs).toBe(3);
    await waitFor(() => expect(result.current.data?.stats.runs).toBe(5));
  });

  it("is kept out of the saved cache", () => {
    global.fetch = jest.fn();
    const { client } = run(seed("project-a"));
    expect(client.getQueryCache().getAll()[0]?.meta).toEqual({ persist: false });
  });

  it("replaces an older cached entry with a newer server seed, without requesting it", async () => {
    global.fetch = jest.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(getDashboardQueryKey("project-a"), { stats: { runs: 1 } }, { updatedAt: Date.now() - 5 * 60_000 });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useDashboard(seed("project-a")), { wrapper });
    expect(result.current.data?.stats.runs).toBe(3);
    await new Promise((r) => setTimeout(r, 20));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps a cached entry that is newer than the seed", () => {
    global.fetch = jest.fn();
    const client = new QueryClient();
    client.setQueryData(getDashboardQueryKey("project-a"), { stats: { runs: 8 } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useDashboard(seed("project-a", Date.now() - 30_000)), { wrapper });
    expect(result.current.data?.stats.runs).toBe(8);
  });
});
