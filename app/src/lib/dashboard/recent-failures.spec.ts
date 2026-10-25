import { selectRecentFailures, isOpenIncident } from "./recent-failures";

const run = (id: string, status: string, startedAt: string) => ({
  id, jobId: "j", jobName: "Job", status, startedAt, trigger: "manual",
});

describe("selectRecentFailures", () => {
  it("returns only failed/error runs, newest first, capped", () => {
    const runs = [
      run("1", "passed", "2026-10-25T10:00:00Z"),
      run("2", "failed", "2026-10-24T10:00:00Z"),
      run("3", "error", "2026-10-25T09:00:00Z"),
      run("4", "blocked", "2026-10-25T11:00:00Z"),
      run("5", "failed", "2026-10-20T10:00:00Z"),
    ];
    expect(selectRecentFailures(runs, 2).map((r) => r.id)).toEqual(["3", "2"]);
  });

  it("returns empty when nothing failed", () => {
    expect(selectRecentFailures([run("1", "passed", "2026-10-25T10:00:00Z")])).toEqual([]);
  });
});

describe("isOpenIncident", () => {
  it("treats everything except resolved as open", () => {
    expect(isOpenIncident({ status: "triggered" })).toBe(true);
    expect(isOpenIncident({ status: "verifying" })).toBe(true);
    expect(isOpenIncident({ status: "resolved" })).toBe(false);
  });
});
