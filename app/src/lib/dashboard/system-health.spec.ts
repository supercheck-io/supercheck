import { buildSystemIssues } from "./system-health";

const queue = { running: 0, runningCapacity: 5, queued: 0 };

describe("buildSystemIssues", () => {
  it("is empty when everything is healthy", () => {
    expect(
      buildSystemIssues({ monitorsDown: 0, downMonitors: [], failedRuns24h: 0, queue })
    ).toEqual([]);
  });

  it("keeps queue capacity issues alongside monitor and job issues", () => {
    const issues = buildSystemIssues({
      monitorsDown: 1,
      downMonitors: [{ name: "API", type: "http_request" }],
      failedRuns24h: 2,
      queue: { running: 5, runningCapacity: 5, queued: 12 },
    });
    expect(issues.map((i) => i.type)).toEqual(["monitor", "monitor", "job", "queue", "queue"]);
    expect(issues.some((i) => /at capacity/.test(i.message))).toBe(true);
  });

  it("flags nearing capacity at 80%", () => {
    const issues = buildSystemIssues({
      monitorsDown: 0, downMonitors: [], failedRuns24h: 0,
      queue: { running: 4, runningCapacity: 5, queued: 0 },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("medium");
  });
});
