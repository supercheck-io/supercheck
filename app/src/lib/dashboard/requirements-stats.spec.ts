import {
  AT_RISK_PRIORITIES,
  accumulateRequirementCoverage,
} from "./requirements-stats";

describe("accumulateRequirementCoverage", () => {
  it("accumulates a null-status group and a 'missing' group instead of overwriting", () => {
    const totals = accumulateRequirementCoverage([
      { status: null, count: "3" },
      { status: "missing", count: 2 },
      { status: "covered", count: 5 },
      { status: "failing", count: 1 },
    ]);
    expect(totals).toEqual({ total: 11, covered: 5, failing: 1, missing: 5 });
  });

  it("is order independent", () => {
    const totals = accumulateRequirementCoverage([
      { status: "missing", count: 2 },
      { status: null, count: 3 },
    ]);
    expect(totals.missing).toBe(5);
  });

  it("returns zeros for no rows and ignores non-numeric counts", () => {
    expect(accumulateRequirementCoverage([])).toEqual({
      total: 0,
      covered: 0,
      failing: 0,
      missing: 0,
    });
    expect(
      accumulateRequirementCoverage([{ status: "covered", count: "abc" }]).total
    ).toBe(0);
  });

  it("defines at-risk as high priority only", () => {
    expect(AT_RISK_PRIORITIES).toEqual(["high"]);
  });
});
