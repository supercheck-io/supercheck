import { checkUptimePercentage } from "./status-page-uptime";

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
  it("weighted_average scales by weight", () => {
    expect(combineMonitorDay([{ ...up, weight: 3 }, down], "weighted_average", 1)).toEqual({ totalChecks: 400, successfulChecks: 300 });
  });
  it("a single monitor passes through unchanged", () => {
    expect(combineMonitorDay([down], "best_case", 3)).toEqual({ totalChecks: 100, successfulChecks: 0 });
  });
});
