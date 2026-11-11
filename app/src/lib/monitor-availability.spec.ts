import { planRawGaps } from "./monitor-availability";

jest.mock("@/utils/db", () => ({ db: {} }));

const H = 3_600_000;
const D = 24 * H;
const created = new Date(0);
const plan = (over: Partial<Parameters<typeof planRawGaps>[0]>) =>
  planRawGaps({
    monitors: [{ id: "m", createdAt: created }],
    covered: new Map(),
    from: 0,
    now: 0,
    unit: D,
    ...over,
  }).map(({ from, to }) => [from, to]);

describe("planRawGaps", () => {
  it("reads the partial first period and the open current period raw, and covered days from aggregates", () => {
    const from = 10 * D + 6 * H;
    const now = 13 * D + 2 * H;
    expect(plan({ from, now, covered: new Map([["m", new Set([11 * D, 12 * D])]]) })).toEqual([
      [from, 11 * D],
      [13 * D, null],
    ]);
  });

  it("falls back to raw for a missed period and merges adjacent ranges", () => {
    const now = 13 * D + H;
    expect(plan({ from: 10 * D, now, covered: new Map([["m", new Set([10 * D, 12 * D])]]) })).toEqual([
      [11 * D, 12 * D],
      [13 * D, null],
    ]);
    expect(plan({ from: 10 * D, now, covered: new Map([["m", new Set([10 * D])]]) })).toEqual([[11 * D, null]]);
  });

  it("does not look for periods before the monitor existed", () => {
    expect(plan({ from: 10 * D, now: 13 * D + H, monitors: [{ id: "m", createdAt: new Date(12 * D + H) }] })).toEqual([
      [12 * D, null],
    ]);
  });

  it("reads a window inside one unfinished period entirely raw", () => {
    expect(plan({ from: 5 * D + H, now: 5 * D + 5 * H })).toEqual([[5 * D + H, null]]);
  });

  it("starts exactly on a boundary without a partial first range and plans per monitor and unit", () => {
    const gaps = planRawGaps({
      monitors: [{ id: "a", createdAt: null }, { id: "b", createdAt: null }],
      covered: new Map([["a", new Set([0, H])]]),
      from: 0,
      now: 3 * H + 1,
      unit: H,
    });
    expect(gaps).toEqual([
      { monitorId: "a", from: 2 * H, to: null },
      { monitorId: "b", from: 0, to: null },
    ]);
  });
});
