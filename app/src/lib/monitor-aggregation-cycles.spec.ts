/** @jest-environment node */
import {
  addToHistogram,
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
    select: jest.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const key of ["from", "where", "orderBy", "limit"]) chain[key] = () => chain;
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
    expect(settle(t0 + 40 * 60_000)).toEqual([{ start: t0, isUp: true }]);
    // A complete cycle counts at once.
    expect(groupChecks([...inFlight, row("c", true, 0, "g1")], resolve, t0 + 60_000)).toHaveLength(1);
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

  it("counts raw rows in periods the aggregator never wrote, not only the window edges", async () => {
    // Aggregates exist for 2 days; the day after them (paused monitor's last partial day) has raw rows only.
    queue.length = 0;
    queue.push([aggregate(0), aggregate(1)]);
    queue.push([{ ...row("local", false, 0, null), checkedAt: new Date(dayStart + 86_400_000 + 5 * 3_600_000) }]);
    const result = await monitorAggregationService.getWindowMetrics("m", "daily", windowStart, now, null);
    expect(result.totalChecks).toBe(21);
    expect(result.successfulChecks).toBe(20);
    expect(result.uptimePercentage).toBeCloseTo((20 / 21) * 100);
  });

  it("counts a lone row of a multi-region monitor as down (missing regions are down), not up", async () => {
    queue.length = 0;
    queue.push([]); // no aggregates: the whole window is read raw
    queue.push([row("a", true, -3 * 3_600_000, "g1")].map((r) => ({ ...r, checkedAt: new Date(dayStart + 86_400_000 + 3_600_000) })));
    queue.push([{ config: { locationConfig: { enabled: true, locations: ["a", "b", "c"], strategy: "majority", threshold: 50 } } }]);
    queue.push([]); // no persisted cycle snapshot
    const result = await monitorAggregationService.getWindowMetrics("m", "daily", windowStart, now, null);
    expect(result).toMatchObject({ totalChecks: 1, successfulChecks: 0 });
  });

  it("prefers the persisted cycle snapshot over the monitor's current config", async () => {
    queue.length = 0;
    queue.push([]);
    queue.push([row("a", true, 0, "g1")].map((r) => ({ ...r, checkedAt: new Date(dayStart + 86_400_000 + 3_600_000) })));
    queue.push([{ config: { locationConfig: { enabled: true, locations: ["a", "b", "c"], strategy: "majority", threshold: 50 } } }]);
    queue.push([{ id: "g1", strategy: "any", threshold: 100, expectedLocations: ["a", "b", "c"] }]);
    const result = await monitorAggregationService.getWindowMetrics("m", "daily", windowStart, now, null);
    expect(result).toMatchObject({ totalChecks: 1, successfulChecks: 1 });
  });

  it("returns null uptime for an empty window", async () => {
    queue.length = 0;
    const result = await monitorAggregationService.getWindowMetrics("m", "daily", windowStart, now, null);
    expect(result).toMatchObject({ totalChecks: 0, uptimePercentage: null, avgResponseMs: null, p95ResponseMs: null });
  });
});
