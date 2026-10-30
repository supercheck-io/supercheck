import { computeCoverageStatus } from "./coverage-status";

// Same table is asserted in the worker requirement-coverage.service.spec.ts.
describe("computeCoverageStatus", () => {
  const cases: [number, number, number, string][] = [
    [0, 0, 0, "missing"],
    [3, 0, 0, "missing"],
    [3, 2, 0, "covered"],
    [3, 2, 1, "failing"],
    [1, 0, 1, "failing"],
  ];
  it.each(cases)("linked=%i passed=%i failed=%i -> %s", (l, p, f, want) => {
    expect(computeCoverageStatus(l, p, f)).toBe(want);
  });
});
