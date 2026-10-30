import { QueryClient } from "@tanstack/react-query";
import {
  canToggleMonitors,
  formatUptime,
  getResumeStatus,
  invalidateMonitorCaches,
  mergeEditConfig,
  withCurrentInterval,
} from "./monitor-actions";
import { Role } from "@/lib/rbac/permissions-client";

describe("mergeEditConfig", () => {
  const stored = {
    method: "POST",
    expectedStatusCodes: "200",
    timeoutSeconds: 12,
    retryStrategy: { maxRetries: 3 },
    alertChannels: ["a"],
    regions: ["eu"],
    sslCheckFrequencyHours: 6,
    body: '{"a":1}',
    keywordInBody: "ok",
    keywordInBodyShouldBePresent: true,
  };

  it("keeps tuned and unmanaged keys when only the name changes", () => {
    // the form rebuilds this much and hardcodes timeoutSeconds 30
    const built = { method: "POST", expectedStatusCodes: "200", timeoutSeconds: 30, body: '{"a":1}', keywordInBody: "ok", keywordInBodyShouldBePresent: true };
    const merged = mergeEditConfig("http_request", stored, built);
    expect(merged).toEqual(stored);
  });

  it("drops fields the user cleared", () => {
    const built = { method: "POST", expectedStatusCodes: "200", timeoutSeconds: 30 };
    const merged = mergeEditConfig("http_request", stored, built);
    expect(merged).not.toHaveProperty("body");
    expect(merged).not.toHaveProperty("keywordInBody");
    expect(merged.timeoutSeconds).toBe(12);
  });

  it("does not force GET on website monitors", () => {
    const merged = mergeEditConfig("website", { method: "HEAD", timeoutSeconds: 9 }, { method: "GET", timeoutSeconds: 30, enableSslCheck: true });
    expect(merged).toMatchObject({ method: "HEAD", timeoutSeconds: 9, enableSslCheck: true });
  });

  it("keeps synthetic playwrightOptions", () => {
    const merged = mergeEditConfig("synthetic_test", { testId: "t", playwrightOptions: { timeout: 1, retries: 2 } }, { testId: "t", playwrightOptions: { timeout: 300000, retries: 0 } });
    expect(merged.playwrightOptions).toEqual({ timeout: 1, retries: 2 });
  });
});

describe("withCurrentInterval", () => {
  const opts = [{ value: "60", label: "1 minute" }, { value: "300", label: "5 minutes" }];
  it("adds a non-preset interval as selectable", () => {
    expect(withCurrentInterval(opts, "420")[0]).toEqual({ value: "420", label: "Every 7 minutes (current)" });
  });
  it("leaves presets alone", () => {
    expect(withCurrentInterval(opts, "300")).toBe(opts);
  });
  it("keeps a legacy sub-floor value selectable", () => {
    expect(withCurrentInterval([{ value: "300", label: "5 minutes" }], "120")[0].value).toBe("120");
  });
});

describe("formatUptime", () => {
  it("floors to 2 decimals and shows 100 only when exact", () => {
    expect(formatUptime(99.996)).toBe("99.99%");
    expect(formatUptime(99.95)).toBe("99.95%");
    expect(formatUptime(100)).toBe("100.00%");
  });
});

describe("pause/resume helpers", () => {
  it("resumes to last known result, else pending", () => {
    expect(getResumeStatus(true)).toBe("up");
    expect(getResumeStatus(false)).toBe("down");
    expect(getResumeStatus(undefined)).toBe("pending");
  });
  it("viewers cannot toggle, editors can", () => {
    expect(canToggleMonitors(Role.PROJECT_VIEWER)).toBe(false);
    expect(canToggleMonitors(Role.PROJECT_EDITOR)).toBe(true);
    expect(canToggleMonitors(null)).toBe(false);
  });
});

describe("invalidateMonitorCaches", () => {
  it("invalidates list, dashboard, single monitor, stats and results", () => {
    const client = new QueryClient();
    const spy = jest.spyOn(client, "invalidateQueries");
    invalidateMonitorCaches(client, "m1");
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([["monitor", "m1"], ["monitor-stats", "m1"], ["monitor-results", "m1"], ["dashboard"]]));
  });
});
