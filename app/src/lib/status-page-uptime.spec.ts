import { buildUptimeDays, checkUptimePercentage } from "./status-page-uptime";

it("counts actual observations instead of incident days", () => {
  expect(
    checkUptimePercentage([
      { date: "2026-10-19", totalChecks: 1000, successfulChecks: 999 },
    ]),
  ).toBe(99.9);
  expect(checkUptimePercentage([])).toBeNull();
});

it("weights the interval by checks rather than rounding each day to up or down", () => {
  expect(
    checkUptimePercentage([
      { date: "2026-10-18", totalChecks: 900, successfulChecks: 900 },
      { date: "2026-10-19", totalChecks: 100, successfulChecks: 0 },
    ]),
  ).toBe(90);
});

import { combineMonitorDay } from "./status-page-uptime";

describe("combineMonitorDay", () => {
  const up = { weight: 1, totalChecks: 100, successfulChecks: 100 };
  const down = { weight: 1, totalChecks: 100, successfulChecks: 0 };

  it("worst_case follows the worst monitor", () => {
    expect(combineMonitorDay([up, down], "worst_case", 1)).toEqual({ totalChecks: 100, successfulChecks: 0 });
  });
  it("best_case follows the best monitor", () => {
    expect(combineMonitorDay([up, down], "best_case", 1)).toEqual({ totalChecks: 100, successfulChecks: 100 });
  });
  it("failureThreshold 2 tolerates a single failing monitor", () => {
    expect(combineMonitorDay([up, down], "worst_case", 2)).toEqual({ totalChecks: 100, successfulChecks: 100 });
    expect(combineMonitorDay([down, down], "worst_case", 2)).toEqual({ totalChecks: 100, successfulChecks: 0 });
  });
  it("weighted_average weights per-monitor ratios, not check volume", () => {
    expect(combineMonitorDay([{ ...up, weight: 3 }, down], "weighted_average", 1)).toEqual({ totalChecks: 10000, successfulChecks: 7500 });
    const busy = { weight: 1, totalChecks: 100, successfulChecks: 100 };
    const quietDown = { weight: 1, totalChecks: 1, successfulChecks: 0 };
    expect(combineMonitorDay([busy, quietDown], "weighted_average", 1).successfulChecks).toBe(5000);
  });
  it("majority_vote resolves an even tie to the worse monitor", () => {
    expect(combineMonitorDay([up, down], "majority_vote", 1)).toEqual({ totalChecks: 100, successfulChecks: 0 });
  });
  it("a threshold above the monitor count never fails the component", () => {
    expect(combineMonitorDay([down], "worst_case", 2)).toEqual({ totalChecks: 100, successfulChecks: 100 });
  });
  it("a single monitor passes through unchanged", () => {
    expect(combineMonitorDay([down], "best_case", 1)).toEqual({ totalChecks: 100, successfulChecks: 0 });
  });
});

describe("buildUptimeDays", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  type Input = Parameters<typeof buildUptimeDays>[0]["incidents"][number];
  const incident = (over: Partial<Input>): Input => ({
    id: "i1", name: "API errors", impact: "major", status: "resolved",
    createdAt: "2026-11-20T10:00:00Z", resolvedAt: "2026-11-20T12:00:00Z", ...over,
  });
  const day = (days: ReturnType<typeof buildUptimeDays>["days"], date: string) =>
    days.find((entry) => entry.date.toISOString().startsWith(date))!;

  it("manual: green by default, grey only before the component started", () => {
    const { days, uptime } = buildUptimeDays({ now, startedAt: "2026-11-01T08:00:00Z", incidents: [] });
    expect(days).toHaveLength(90);
    expect(day(days, "2026-10-31").level).toBe("nodata");
    expect(day(days, "2026-11-01").level).toBe("operational");
    expect(uptime).toBe(100);
  });

  it("manual: times the component's own status, weighting major fully and partial at 30%", () => {
    const start = "2026-11-21T12:00:00Z"; // a 24-hour window
    const major = buildUptimeDays({ now, startedAt: start, incidents: [incident({ impact: "minor", componentStatus: "major_outage", createdAt: "2026-11-22T00:00:00Z", resolvedAt: "2026-11-22T06:00:00Z" })] });
    expect(major.uptime).toBeCloseTo(75);
    const partial = buildUptimeDays({ now, startedAt: start, incidents: [incident({ impact: "critical", componentStatus: "partial_outage", createdAt: "2026-11-22T00:00:00Z", resolvedAt: "2026-11-22T12:00:00Z" })] });
    expect(partial.uptime).toBeCloseTo(85);
    const degraded = buildUptimeDays({ now, startedAt: start, incidents: [incident({ impact: "critical", componentStatus: "degraded_performance", createdAt: "2026-11-22T00:00:00Z", resolvedAt: "2026-11-22T12:00:00Z" })] });
    expect(degraded.uptime).toBe(100);
    expect(day(degraded.days, "2026-11-22").level).toBe("minor");
  });

  it("manual: an update that left the component operational is not downtime, whatever its impact", () => {
    const { days, uptime } = buildUptimeDays({ now, startedAt: "2026-11-21T12:00:00Z", incidents: [incident({ impact: "critical", componentStatus: "operational", createdAt: "2026-11-22T00:00:00Z", resolvedAt: "2026-11-22T06:00:00Z" })] });
    expect(uptime).toBe(100);
    expect(day(days, "2026-11-22").level).toBe("operational");
  });

  it("manual: older rows without a component status fall back to the impact", () => {
    const { uptime } = buildUptimeDays({ now, startedAt: "2026-11-21T12:00:00Z", incidents: [incident({ impact: "critical", createdAt: "2026-11-22T00:00:00Z", resolvedAt: "2026-11-22T06:00:00Z" })] });
    expect(uptime).toBeCloseTo(75);
  });

  it("manual: a short blip is yellow, an hour of weighted downtime is red, overlaps count once", () => {
    const { days } = buildUptimeDays({
      now,
      startedAt: "2026-01-01T00:00:00Z",
      incidents: [
        incident({ id: "blip", componentStatus: "major_outage", createdAt: "2026-11-18T10:00:00Z", resolvedAt: "2026-11-18T10:01:00Z" }),
        incident({ id: "hour", componentStatus: "major_outage", createdAt: "2026-11-19T10:00:00Z", resolvedAt: "2026-11-19T11:00:00Z" }),
        incident({ id: "dup", componentStatus: "major_outage", createdAt: "2026-11-19T10:30:00Z", resolvedAt: "2026-11-19T11:00:00Z" }),
      ],
    });
    expect(day(days, "2026-11-18").level).toBe("minor");
    expect(day(days, "2026-11-19").level).toBe("critical");
    expect(day(days, "2026-11-19").uptime).toBeCloseTo((1 - 60 / 1440) * 100);
  });

  it("manual: an outage across midnight colours both days; maintenance is blue and not downtime", () => {
    const { days, uptime } = buildUptimeDays({
      now,
      startedAt: "2026-11-21T12:00:00Z",
      incidents: [
        incident({ componentStatus: "major_outage", createdAt: "2026-11-21T22:00:00Z", resolvedAt: "2026-11-22T02:00:00Z" }),
        incident({ id: "m", impact: "none", scheduledFor: "2026-11-22T05:00:00Z", scheduledUntil: "2026-11-22T06:00:00Z", status: "resolved", resolvedAt: "2026-11-22T06:00:00Z" }),
        incident({ id: "future", impact: "none", scheduledFor: "2026-11-25T01:00:00Z", status: "scheduled", resolvedAt: null }),
      ],
    });
    expect(day(days, "2026-11-21").level).toBe("critical");
    expect(day(days, "2026-11-22").level).toBe("critical");
    expect(day(days, "2026-11-22").incidents.map((entry) => entry.level)).toEqual(["critical", "maintenance"]);
    expect(uptime).toBeCloseTo((1 - 4 / 24) * 100);
  });

  it("manual: open incidents run until now; legacy resolved rows end at their last change", () => {
    const open = buildUptimeDays({ now, startedAt: "2026-11-21T12:00:00Z", incidents: [incident({ status: "investigating", componentStatus: "major_outage", createdAt: "2026-11-22T06:00:00Z", resolvedAt: null })] });
    expect(open.uptime).toBeCloseTo(75);
    const legacy = buildUptimeDays({ now, startedAt: "2026-11-21T12:00:00Z", incidents: [incident({ componentStatus: "major_outage", createdAt: "2026-11-22T00:00:00Z", resolvedAt: null, updatedAt: "2026-11-22T06:00:00Z" })] });
    expect(legacy.uptime).toBeCloseTo(75);
  });

  it("manual: a status set by hand colours today only and stays out of uptime", () => {
    const { days, uptime } = buildUptimeDays({ now, startedAt: "2026-11-01T00:00:00Z", incidents: [], currentStatus: "major_outage" });
    expect(day(days, "2026-11-22").level).toBe("critical");
    expect(day(days, "2026-11-21").level).toBe("operational");
    expect(uptime).toBe(100);
  });

  it("monitored: bars follow checks, and a day without checks has no data", () => {
    const { days, uptime } = buildUptimeDays({
      now,
      startedAt: null,
      incidents: [],
      metrics: [
        { date: "2026-11-10", totalChecks: 100, successfulChecks: 100 },
        { date: "2026-11-12", totalChecks: 100, successfulChecks: 50 },
        { date: "2026-11-13", totalChecks: 100, successfulChecks: 0 },
      ],
    });
    expect(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map((date) => day(days, date).level)).toEqual([
      "nodata", "operational", "nodata", "minor", "critical",
    ]);
    expect(days.filter((entry) => entry.level !== "nodata")).toHaveLength(3);
    expect(uptime).toBe(50);
  });

  it("has no uptime before the component starts, or without checks", () => {
    expect(buildUptimeDays({ now, startedAt: "2026-12-01T00:00:00Z", incidents: [] }).uptime).toBeNull();
    expect(buildUptimeDays({ now, startedAt: null, incidents: [], metrics: [] }).uptime).toBeNull();
  });
});
