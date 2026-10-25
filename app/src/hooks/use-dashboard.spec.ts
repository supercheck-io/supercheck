import { fetchDashboard, parseSystemHealth } from "./use-dashboard";
import { selectRecentFailures } from "@/lib/dashboard/recent-failures";

describe("dashboard data contract", () => {
  afterEach(() => jest.restoreAllMocks());

  it("keeps today's trend buckets and failures beyond the first 1000 runs", async () => {
    const trend = Array.from({ length: 31 }, (_, i) => ({ date: String(i), uptime: 100, count: i }));
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        monitors: { availabilityTrend: trend },
        tests: { playgroundExecutionsTrend: trend },
        jobs: { recentRuns: Array.from({ length: 1001 }, (_, i) => ({
          id: String(i), status: i === 1000 ? "failed" : "passed", startedAt: "2026-10-25T10:00:00Z",
        })) },
      }),
    } as Response);
    const data = await fetchDashboard();
    expect(data.monitors.availabilityTrend?.at(-1)?.date).toBe("30");
    expect(data.tests.playgroundExecutionsTrend.at(-1)?.date).toBe("30");
    expect(selectRecentFailures(data.jobs.recentRuns).map((r) => r.id)).toEqual(["1000"]);
  });

  it("keeps an empty alert history when the alerts endpoint is unavailable", async () => {
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jobs: { recentRuns30d: 8 } }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    const data = await fetchDashboard("project-a");
    expect(data.stats.runs).toBe(8);
    expect(data.alerts).toEqual([]);
    expect(data.jobs.recentRuns).toEqual([]);
    expect(data.tests.playgroundExecutionsTrend).toEqual([]);
  });

  it("rejects unavailable dashboard data instead of returning a partial dashboard", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 503, statusText: "Unavailable" } as Response);
    await expect(fetchDashboard()).rejects.toThrow("Dashboard API error: 503 Unavailable");
  });

  it("aborts stalled requests and clears the timeout", async () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(global, "fetch").mockImplementation((_url: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
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
