import { planRawGaps } from "./monitor-availability";

jest.mock("@/utils/db", () => ({ db: {} }));

const H = 3_600_000;
const D = 24 * H;
const plan = (over: Partial<Parameters<typeof planRawGaps>[0]>) =>
  planRawGaps({ monitors: [{ id: "m" }], covered: new Map(), from: 0, now: 0, unit: D, ...over }).map(({ from, to }) => [from, to]);

describe("planRawGaps", () => {
  it("reads the partial first period, the last completed and the current period raw, covered days from aggregates", () => {
    const from = 10 * D + 6 * H;
    const now = 14 * D + 2 * H;
    expect(plan({ from, now, covered: new Map([["m", new Set([11 * D, 12 * D])]]) })).toEqual([
      [from, 11 * D],
      [13 * D, null],
    ]);
  });

  it("falls back to raw for a missed period and merges adjacent ranges", () => {
    const now = 14 * D + H;
    expect(plan({ from: 10 * D, now, covered: new Map([["m", new Set([10 * D, 12 * D])]]) })).toEqual([
      [11 * D, 12 * D],
      [13 * D, null],
    ]);
    expect(plan({ from: 10 * D, now, covered: new Map([["m", new Set([10 * D])]]) })).toEqual([[11 * D, null]]);
  });

  it("reads a window inside the unfinished or the previous period entirely raw", () => {
    expect(plan({ from: 5 * D + H, now: 5 * D + 5 * H })).toEqual([[5 * D + H, null]]);
    expect(plan({ from: 4 * D + H, now: 5 * D + 5 * H })).toEqual([[4 * D + H, null]]);
  });

  it("starts exactly on a boundary without a partial first range and plans each monitor", () => {
    const gaps = planRawGaps({
      monitors: [{ id: "a" }, { id: "b" }],
      covered: new Map([["a", new Set([0, H])]]),
      from: 0,
      now: 4 * H + 1,
      unit: H,
    });
    expect(gaps).toEqual([
      { monitorId: "a", from: 2 * H, to: null },
      { monitorId: "b", from: 0, to: null },
    ]);
  });

  it("keeps each isolated hole of a sparse monitor as its own range", () => {
    const covered = new Map([["m", new Set([1 * H, 3 * H, 5 * H])]]);
    expect(plan({ from: 0, now: 8 * H + 1, unit: H, covered })).toEqual([
      [0, H],
      [2 * H, 3 * H],
      [4 * H, 5 * H],
      [6 * H, null],
    ]);
  });
});
