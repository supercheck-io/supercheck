import {
  summarizeRunOutcomes,
  notPassedCaption,
  passRatePercent,
  isFailedRunStatus,
} from "./run-outcomes";

describe("run outcomes", () => {
  it("counts error as a failure but not in-flight runs", () => {
    expect(isFailedRunStatus("failed")).toBe(true);
    expect(isFailedRunStatus("error")).toBe(true);
    expect(isFailedRunStatus("blocked")).toBe(false);
    expect(isFailedRunStatus("running")).toBe(false);
    expect(isFailedRunStatus(null)).toBe(false);
  });

  it("computes not-passed as every terminal non-passed outcome", () => {
    const s = summarizeRunOutcomes([
      ...Array(16).fill("passed"),
      "error",
    ]);
    expect(s).toMatchObject({ total: 17, passed: 16, failed: 1, notPassed: 1 });
  });

  it("excludes running/queued from not-passed and includes blocked", () => {
    const s = summarizeRunOutcomes(["passed", "running", "queued", "blocked", "failed"]);
    expect(s.notPassed).toBe(2);
    expect(s.inFlight).toBe(2);
    expect(s.total - s.passed - s.inFlight).toBe(s.notPassed);
  });

  it("only says All passing when nothing did not pass", () => {
    expect(notPassedCaption(0)).toBe("All passing");
    expect(notPassedCaption(1)).toBe("Needs attention");
  });

  it("derives pass rate over finished runs", () => {
    expect(passRatePercent(16, 17, 0)).toBe(94.1);
    expect(passRatePercent(1, 3, 2)).toBe(100);
    expect(passRatePercent(0, 2, 2)).toBe(0);
  });
});
