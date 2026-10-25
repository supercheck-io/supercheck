import { parseSystemHealth } from "./use-dashboard";

describe("parseSystemHealth", () => {
  it("preserves the server's issues, including queue capacity", () => {
    const health = parseSystemHealth({
      timestamp: "2026-10-25T10:00:00.000Z",
      healthy: true, // untrusted: derived from the issue list instead
      issues: [
        { type: "queue", message: "Execution queue at capacity (5/5 running)", severity: "high" },
        { type: "job", message: "2 job runs failed in the last 24 hours", severity: "medium" },
      ],
    });
    expect(health.healthy).toBe(false);
    expect(health.issues.map((i) => i.type)).toEqual(["queue", "job"]);
    expect(health.timestamp).toBe("2026-10-25T10:00:00.000Z");
  });

  it("is healthy with no issues and tolerates a missing block", () => {
    expect(parseSystemHealth({ issues: [] }).healthy).toBe(true);
    expect(parseSystemHealth(undefined).issues).toEqual([]);
  });
});
