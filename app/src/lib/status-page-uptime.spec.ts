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
  const incident = (over: Partial<Parameters<typeof buildUptimeDays>[0]["incidents"][number]>) => ({
    id: "i1", name: "API errors", impact: "major", status: "resolved",
    createdAt: "2026-11-20T10:00:00Z", resolvedAt: "2026-11-20T12:00:00Z", ...over,
  });
  const level = (days: ReturnType<typeof buildUptimeDays>["days"], date: string) =>
    days.find((day) => day.date.toISOString().startsWith(date))?.level;

  it("manual: green by default, grey only before the component started", () => {
    const { days, uptime } = buildUptimeDays({ now, startedAt: "2026-11-01T08:00:00Z", incidents: [] });
    expect(days).toHaveLength(90);
    expect(level(days, "2026-10-31")).toBe("nodata");
    expect(level(days, "2026-11-01")).toBe("operational");
    expect(level(days, "2026-11-22")).toBe("operational");
    expect(uptime).toBe(100);
  });

  it("manual: colours every day an incident ran by its impact, maintenance blue", () => {
    const { days } = buildUptimeDays({
      now,
      startedAt: "2026-01-01T00:00:00Z",
      incidents: [
        incident({ impact: "critical", createdAt: "2026-11-18T22:00:00Z", resolvedAt: "2026-11-19T02:00:00Z" }),
        incident({ id: "m", impact: "none", scheduledFor: "2026-11-21T01:00:00Z", scheduledUntil: "2026-11-21T02:00:00Z", status: "completed", resolvedAt: null }),
        incident({ id: "future", impact: "none", scheduledFor: "2026-11-25T01:00:00Z", status: "scheduled", resolvedAt: null }),
      ],
    });
    expect(level(days, "2026-11-18")).toBe("critical");
    expect(level(days, "2026-11-19")).toBe("critical");
    expect(level(days, "2026-11-20")).toBe("operational");
    expect(level(days, "2026-11-21")).toBe("maintenance");
  });

  it("manual: counts a critical incident fully and a major one partly, without double counting overlaps", () => {
    const start = "2026-11-21T12:00:00Z"; // one day window
    const critical = buildUptimeDays({ now, startedAt: start, incidents: [incident({ impact: "critical", createdAt: "2026-11-22T00:00:00Z", resolvedAt: "2026-11-22T06:00:00Z" })] });
    expect(critical.uptime).toBeCloseTo(75);
    const major = buildUptimeDays({ now, startedAt: start, incidents: [incident({ impact: "major", createdAt: "2026-11-22T00:00:00Z", resolvedAt: "2026-11-22T12:00:00Z" })] });
    expect(major.uptime).toBeCloseTo(85);
    const overlap = buildUptimeDays({ now, startedAt: start, incidents: [
      incident({ impact: "critical", createdAt: "2026-11-22T00:00:00Z", resolvedAt: "2026-11-22T06:00:00Z" }),
      incident({ id: "i2", impact: "critical", createdAt: "2026-11-22T03:00:00Z", resolvedAt: "2026-11-22T06:00:00Z" }),
    ] });
    expect(overlap.uptime).toBeCloseTo(75);
  });

  it("automatic: bars follow checks, grey before the first check, green on a later day with none", () => {
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
    expect(level(days, "2026-11-09")).toBe("nodata");
    expect(level(days, "2026-11-10")).toBe("operational");
    expect(level(days, "2026-11-11")).toBe("operational");
    expect(level(days, "2026-11-12")).toBe("minor");
    expect(level(days, "2026-11-13")).toBe("critical");
    expect(uptime).toBe(50);
  });

  it("automatic with no checks yet is all grey with no uptime", () => {
    const { days, uptime } = buildUptimeDays({ now, startedAt: null, incidents: [], metrics: [] });
    expect(days.every((day) => day.level === "nodata")).toBe(true);
    expect(uptime).toBeNull();
  });
});

describe("buildUptimeDays edge cases", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  const level = (days: ReturnType<typeof buildUptimeDays>["days"], date: string) =>
    days.find((day) => day.date.toISOString().startsWith(date))?.level;

  it("keeps an open incident colouring every day up to now, and marks maintenance on a day without checks", () => {
    const manual = buildUptimeDays({ now, startedAt: "2026-11-01T00:00:00Z", incidents: [
      { id: "open", name: "Errors", impact: "minor", status: "investigating", createdAt: "2026-11-20T08:00:00Z", resolvedAt: null },
    ] });
    expect(["2026-11-20", "2026-11-21", "2026-11-22"].map((d) => level(manual.days, d))).toEqual(["minor", "minor", "minor"]);
    expect(manual.uptime).toBe(100); // minor counts as no downtime

    const automatic = buildUptimeDays({
      now,
      startedAt: null,
      incidents: [{ id: "m", name: "Upgrade", impact: "none", status: "completed", createdAt: null, resolvedAt: "2026-11-21T03:00:00Z", scheduledFor: "2026-11-21T01:00:00Z" }],
      metrics: [{ date: "2026-11-20", totalChecks: 10, successfulChecks: 10 }],
    });
    expect(level(automatic.days, "2026-11-21")).toBe("maintenance");
    expect(automatic.days.find((day) => day.level === "maintenance")?.incidents[0].maintenance).toBe(true);
  });

  it("has no uptime before the component starts", () => {
    expect(buildUptimeDays({ now, startedAt: "2026-12-01T00:00:00Z", incidents: [] }).uptime).toBeNull();
  });
});
