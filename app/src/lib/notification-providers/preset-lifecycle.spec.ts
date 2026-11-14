import {
  isPagingPreset,
  presetOverrides,
  presetResolveRequest,
} from "@/lib/notification-providers/preset-lifecycle";

// Full behaviour and parity with the worker copy: worker/src/notification/preset-lifecycle.spec.ts.
describe("preset-lifecycle (app mirror)", () => {
  it("maps statuses and severity per preset", () => {
    expect(presetOverrides("incident_io", "resolve", {})).toEqual({ status: "resolved" });
    expect(presetOverrides("better_stack", "trigger", {})).toEqual({ status: "alert" });
    expect(presetOverrides("pagerduty", "trigger", { alertType: "job_timeout" })).toEqual({ normalizedSeverity: "critical" });
    expect(presetOverrides("pagerduty", "trigger", { alertType: "ssl_expiring" })).toEqual({ normalizedSeverity: "warning" });
    expect(presetOverrides("pagerduty", "trigger", { alertType: "monitor_recovery" })).toEqual({});
    expect(presetOverrides("custom", "trigger", {})).toEqual({});
  });

  it("closes Opsgenie/JSM by encoded alias on the configured host only", () => {
    const request = presetResolveRequest("jsm_ops", "https://api.atlassian.com/jsm/ops/integration/v2/alerts", "test:a/b", "Test");
    expect(request?.url).toBe("https://api.atlassian.com/jsm/ops/integration/v2/alerts/test%3Aa%2Fb/close?identifierType=alias");
    expect(presetResolveRequest("pagerduty", "https://events.pagerduty.com/v2/enqueue", "k", "t")).toBeNull();
    expect(isPagingPreset("opsgenie")).toBe(true);
    expect(isPagingPreset("custom")).toBe(false);
  });
});
