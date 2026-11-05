import { runReportPath } from "./run-report-url";

describe("runReportPath", () => {
  it("replaces the stored storage URL with the app report route", () => {
    expect(runReportPath("r1", "http://rustfs:9000/bucket/r1/report/index.html")).toBe(
      "/api/test-results/r1/report/index.html",
    );
  });

  it("returns null when the run has no report", () => {
    expect(runReportPath("r1", null)).toBeNull();
    expect(runReportPath("r1", "")).toBeNull();
  });
});
