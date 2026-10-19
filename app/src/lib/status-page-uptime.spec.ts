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
