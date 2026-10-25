import {
  buildMonitorStatusBuckets,
  buildUptimeSeries,
  formatDayKey,
  lastDayKeys,
  uptimeAxis,
} from "./chart-data";

const NOW = new Date("2026-10-25T10:00:00Z");

describe("buildUptimeSeries", () => {
  it("produces real dates and leaves missing days as gaps (no backfill)", () => {
    const series = buildUptimeSeries(
      [
        { date: "2026-10-25", uptime: 99.5 },
        { date: "2026-10-23", uptime: 88 },
      ],
      5,
      NOW
    );
    expect(series.map((p) => p.date)).toEqual([
      "Oct 21", "Oct 22", "Oct 23", "Oct 24", "Oct 25",
    ]);
    expect(series.map((p) => p.uptime)).toEqual([null, null, 88, null, 99.5]);
  });

  it("returns all gaps when there is no trend data", () => {
    expect(buildUptimeSeries(undefined, 3, NOW).every((p) => p.uptime === null)).toBe(true);
  });

  it("does not repeat labels across 30 days", () => {
    const labels = buildUptimeSeries([], 30, NOW).map((p) => p.date);
    expect(new Set(labels).size).toBe(30);
  });

  it("clamps out-of-range values", () => {
    expect(buildUptimeSeries([{ date: "2026-10-25", uptime: 140 }], 1, NOW)[0].uptime).toBe(100);
  });
});

describe("uptimeAxis", () => {
  it("floors the min to a clean step and ends at 100", () => {
    const axis = uptimeAxis([49.25, 99, null]);
    expect(axis.domain).toEqual([40, 100]);
    expect(axis.ticks).toEqual([40, 60, 80, 100]);
  });

  it("uses a 5 step for tight ranges", () => {
    const axis = uptimeAxis([97.2, 100]);
    expect(axis.domain).toEqual([95, 100]);
    expect(axis.ticks).toEqual([95, 100]);
  });

  it("handles empty data", () => {
    expect(uptimeAxis([]).domain).toEqual([95, 100]);
  });
});

describe("buildMonitorStatusBuckets", () => {
  it("shows all non-zero buckets, not only up/down", () => {
    const b = buildMonitorStatusBuckets({ up: 3, down: 0, paused: 2, pending: 1, maintenance: 0, error: 4 });
    expect(b.map((x) => [x.name, x.count])).toEqual([
      ["Up", 3], ["Error", 4], ["Pending", 1], ["Paused", 2],
    ]);
  });

  it("returns nothing when all zero", () => {
    expect(buildMonitorStatusBuckets({})).toEqual([]);
  });
});

describe("day keys", () => {
  it("formats keys without timezone shift", () => {
    expect(formatDayKey("2026-01-05")).toBe("Jan 5");
    expect(lastDayKeys(NOW, 2)).toEqual(["2026-10-24", "2026-10-25"]);
  });
});

import { labelRunTrend } from "./chart-data";

describe("labelRunTrend", () => {
  it("labels only the first run of each day on the axis but keeps full tooltip times", () => {
    const labels = labelRunTrend([
      { date: "2026-10-03T08:05:00" },
      { date: "2026-10-03T14:30:00" },
      { date: "2026-10-04T09:00:00" },
      { date: null },
    ]);
    expect(labels.map((l) => l.tickLabel)).toEqual(["Oct 3", "", "Oct 4", ""]);
    expect(labels.map((l) => l.tooltipLabel)).toEqual([
      "Oct 3, 08:05", "Oct 3, 14:30", "Oct 4, 09:00", "",
    ]);
  });
});
