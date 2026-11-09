/** @jest-environment node */
import {
  addToHistogram,
  cycleUpFromCounts,
  groupChecks,
  histogramPercentile,
  isCycleUp,
  monitorAggregationService,
  type CheckRow,
  type CyclePolicy,
  type ResponseHistogram,
} from "./monitor-aggregation-service";

type Rows = unknown[];
const queue: Rows[] = [];
jest.mock("@/utils/db", () => ({
  db: {
    execute: jest.fn(() => Promise.resolve(queue.shift() ?? [])),
    select: jest.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const key of ["from", "where", "orderBy", "limit", "groupBy"]) chain[key] = () => chain;
      chain.then = (resolve: (rows: Rows) => unknown) => Promise.resolve(queue.shift() ?? []).then(resolve);
      return chain;
    }),
  },
}));

const majority3: CyclePolicy = { strategy: "majority", threshold: 50, expected: ["a", "b", "c"] };
const t0 = Date.parse("2026-10-01T10:00:00Z");
const row = (location: string, isUp: boolean, offsetMs = 0, group: string | null = "g1", ms: number | null = 100): CheckRow => ({
  checkedAt: new Date(t0 + offsetMs),
  location,
  isUp,
  responseTimeMs: isUp ? ms : null,
  isStatusChange: false,
  executionGroupId: group,
});

describe("cycleUpFromCounts", () => {
  it("agrees with isCycleUp", () => {
    expect(cycleUpFromCounts({ strategy: "majority", threshold: 50, expected: 3 }, 3, 2)).toBe(true);
    expect(cycleUpFromCounts({ strategy: "all", threshold: 50, expected: 3 }, 2, 2)).toBe(false);
    expect(cycleUpFromCounts(null, 1, 0)).toBe(false);
  });
});

describe("isCycleUp (same rule as the worker's cycle policy)", () => {
  it("counts a majority cycle with one region down as up", () => {
    expect(isCycleUp(majority3, { a: true, b: true, c: false })).toBe(true);
    expect(isCycleUp(majority3, { a: true, b: false, c: false })).toBe(false);
  });

  it("treats a region that never reported as down", () => {
    expect(isCycleUp(majority3, { a: true })).toBe(false);
    expect(isCycleUp({ ...majority3, strategy: "any" }, { a: true })).toBe(true);
    expect(isCycleUp({ ...majority3, strategy: "all" }, { a: true, b: true })).toBe(false);
    expect(isCycleUp({ ...majority3, strategy: "all" }, { a: true, b: true, c: true })).toBe(true);
  });

  it("uses the region count rounded up for thresholds (ceil(n * threshold / 100))", () => {
    const policy: CyclePolicy = { strategy: "majority", threshold: 60, expected: ["a", "b", "c"] };
    expect(isCycleUp(policy, { a: true, b: true, c: false })).toBe(true);
    expect(isCycleUp(policy, { a: true, b: false, c: false })).toBe(false);
  });

  it("single-region (no policy) is up when the region is up", () => {
    expect(isCycleUp(null, { local: true })).toBe(true);
    expect(isCycleUp(null, { local: false })).toBe(false);
  });
});

describe("groupChecks", () => {
  const resolve = () => majority3;

  it("counts one check per cycle: 3-region majority with one region always down is 100% up", () => {
    const rows = [0, 1, 2].flatMap((i) => [
      row("a", true, i * 60_000, `g${i}`),
      row("b", true, i * 60_000, `g${i}`),
      row("c", false, i * 60_000, `g${i}`),
    ]);
    const checks = groupChecks(rows, resolve);
    expect(checks).toHaveLength(3);
    expect(checks.every((check) => check.isUp)).toBe(true);
  });

  it("counts rows without an execution group once each", () => {
    const checks = groupChecks([row("a", true, 0, null), row("a", false, 60_000, null)], resolve);
    expect(checks.map((check) => check.isUp)).toEqual([true, false]);
  });

  it("attributes a cycle to its earliest row and lets a retried region replace its first attempt", () => {
    const checks = groupChecks(
      [row("b", true, 30_000), row("a", false, 0), row("a", true, 20_000), row("c", false, 10_000)],
      resolve,
    );
    expect(checks).toEqual([{ start: t0, isUp: true }]);
  });

  it("leaves a cycle that is still waiting for a region out until it settles", () => {
    const inFlight = [row("a", true, 0, "g1"), row("b", true, 0, "g1")];
    const settle = (nowMs: number) => groupChecks(inFlight, resolve, nowMs);
    expect(settle(t0 + 60_000)).toEqual([]);
    expect(settle(t0 + 70 * 60_000)).toEqual([{ start: t0, isUp: true }]);
    // A complete cycle counts at once.
    expect(groupChecks([...inFlight, row("c", true, 0, "g1")], resolve, t0 + 60_000)).toHaveLength(1);
  });

  it("honours a persisted deadline: in flight before it, down after it", () => {
    const withDeadline = () => ({ ...majority3, deadlineAt: t0 + 50 * 60_000 });
    const rows = [row("a", true, 0, "g1"), row("b", true, 0, "g1")];
    expect(groupChecks(rows, withDeadline, t0 + 49 * 60_000)).toEqual([]);
    expect(groupChecks(rows, withDeadline, t0 + 51 * 60_000)).toEqual([{ start: t0, isUp: true }]);
  });

  it("passes the union of the enqueued regions to the resolver as a hint", () => {
    const seen: (string[] | null)[] = [];
    groupChecks(
      [
        { ...row("a", true, 0, "g1"), expectedLocations: ["a", "b"] },
        { ...row("b", true, 0, "g1"), expectedLocations: ["a", "b"] },
        row("c", true, 0, "g2"),
      ],
      (_g, _o, hint) => (seen.push(hint), majority3),
    );
    expect(seen).toEqual([["a", "b"], null]);
  });

  it("uses a single-region rule when the resolver has no policy", () => {
    expect(groupChecks([row("local", false)], () => null)).toEqual([{ start: t0, isUp: false }]);
  });
});

describe("response-time histogram", () => {
  it("reads a p95 within 3% of the exact value after merging periods", () => {
    const values = Array.from({ length: 2000 }, (_, i) => 50 + ((i * 37) % 900) + (i % 40 === 0 ? 4000 : 0));
    const halves: ResponseHistogram[] = [{}, {}];
    values.forEach((ms, i) => addToHistogram(halves[i % 2], ms));
    const merged: ResponseHistogram = {};
    for (const half of halves) for (const [k, n] of Object.entries(half)) merged[k] = (merged[k] ?? 0) + n;
    const sorted = [...values].sort((a, b) => a - b);
    const exact = sorted[Math.ceil(0.95 * sorted.length) - 1];
    expect(Math.abs(histogramPercentile(merged, 95)! - exact) / exact).toBeLessThan(0.03);
    // The old combination (median of per-period p95s) is not a p95 at all.
    expect(histogramPercentile({}, 95)).toBeNull();
  });
});

describe("getWindowMetrics tail", () => {
  const dayStart = Date.parse("2026-10-10T00:00:00Z");
  const now = new Date(dayStart + 2 * 86_400_000 + 3 * 3_600_000);
  const windowStart = new Date(now.getTime() - 4 * 86_400_000);
  const aggregate = (offsetDays: number) => ({
    location: null,
    periodStart: new Date(dayStart - offsetDays * 86_400_000),
    totalChecks: 10,
    successfulChecks: 10,
    totalResponseMs: 1000,
    avgResponseMs: 100,
    responseSampleCount: 10,
    responseHistogram: null,
    p50ResponseMs: 100,
    p95ResponseMs: 100,
    p99ResponseMs: 100,
    maxResponseMs: 100,
    updatedAt: now,
  });

  // Query order for an all-locations window: aggregates, monitor config, cycle shapes, solo rows, response buckets.
  const shape = (over: Record<string, unknown> = {}) => ({
    observed: 1, up: 1, recent: false, strategy: null, threshold: null, expected: null, cycles: 1, ...over,
  });
  const multiRegion = [{ config: { locationConfig: { enabled: true, locations: ["a", "b", "c"], strategy: "majority", threshold: 50 } } }];
  const run = (...results: Rows[]) => {
    queue.length = 0;
    queue.push(...results);
    return monitorAggregationService.getWindowMetrics("m", "daily", windowStart, now, null);
  };

  it("counts rows in periods the aggregator never wrote, summarised in SQL rather than loaded", async () => {
    const result = await run([aggregate(0), aggregate(1)], [], [], [{ total: 1, up: 0 }], [{ bucket: 100, n: 4, sum: 400 }]);
    expect(result.totalChecks).toBe(21);
    expect(result.successfulChecks).toBe(20);
    expect(result.uptimePercentage).toBeCloseTo((20 / 21) * 100);
    expect(result.avgResponseMs).toBe(100);
    // Every query after the aggregate read is an aggregate: no per-row result set can reach the process.
    expect(queue).toHaveLength(0);
  });

  it("counts a lone row of a multi-region monitor as down (missing regions are down), not up", async () => {
    expect(await run([], multiRegion, [shape()], [], [])).toMatchObject({ totalChecks: 1, successfulChecks: 0 });
  });

  it("prefers the persisted cycle snapshot over the monitor's current config", async () => {
    const snapshot = shape({ strategy: "any", threshold: 100, expected: 3 });
    expect(await run([], multiRegion, [snapshot], [], [])).toMatchObject({ totalChecks: 1, successfulChecks: 1 });
  });

  it("leaves a recent cycle that still misses a region out of the window", async () => {
    expect(await run([], multiRegion, [shape({ recent: true })], [], [])).toMatchObject({ totalChecks: 0 });
    expect(await run([], multiRegion, [shape({ recent: true, observed: 3, up: 3 })], [], [])).toMatchObject({ totalChecks: 1, successfulChecks: 1 });
  });

  it("returns null uptime for an empty window", async () => {
    const result = await run();
    expect(result).toMatchObject({ totalChecks: 0, uptimePercentage: null, avgResponseMs: null, p95ResponseMs: null });
  });
});

describe("getCheckCountsForMonitors", () => {
  it("runs a constant number of queries however many monitors it covers", async () => {
    const { db } = jest.requireMock("@/utils/db") as { db: { select: jest.Mock; execute: jest.Mock } };
    const calls = async (count: number) => {
      db.select.mockClear();
      db.execute.mockClear();
      queue.length = 0;
      const ids = Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
      await monitorAggregationService.getCheckCountsForMonitors(ids, new Date("2026-10-10T00:00:00Z"), new Date("2026-10-10T05:30:00Z"));
      return db.select.mock.calls.length + db.execute.mock.calls.length;
    };
    const few = await calls(2);
    expect(few).toBeLessThanOrEqual(5);
    expect(await calls(60)).toBe(few);
  });

  it("sums completed-hour aggregates and the SQL cycle summary per monitor", async () => {
    queue.length = 0;
    const hour = (h: number) => new Date(Date.UTC(2026, 9, 10, h));
    queue.push(
      [
        { monitorId: "m1", periodStart: hour(0), location: null, totalChecks: 10, successfulChecks: 9 },
        { monitorId: "m1", periodStart: hour(0), location: "a", totalChecks: 30, successfulChecks: 1 },
      ],
      [{ id: "m1", config: { locationConfig: { enabled: true, locations: ["a", "b", "c"], strategy: "majority", threshold: 50 } } }],
      [{ monitor_id: "m1", observed: 3, up: 2, recent: false, strategy: null, threshold: null, expected: null, cycles: 4 }],
      [{ monitorId: "m1", total: 2, up: 1 }],
    );
    const result = await monitorAggregationService.getCheckCountsForMonitors(["m1"], hour(0), new Date(hour(5).getTime() + 30 * 60_000));
    expect(result.get("m1")).toEqual({ totalChecks: 16, successfulChecks: 14 });
  });
});
