import { QueryClient } from "@tanstack/react-query";
import {
  canToggleMonitors,
  formatUptime,
  getResumeStatus,
  invalidateDeletedMonitorCaches,
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

  it("replaces the stored preset timeout with the plain default when the preset is switched off", () => {
    const aiStored = { aiEndpoint: { model: "m" }, timeoutSeconds: 60 };
    const built = { method: "GET", expectedStatusCodes: "200-299", timeoutSeconds: 30 };
    const merged = mergeEditConfig("http_request", aiStored, built);
    expect(merged).toEqual(built);
    // A plain monitor keeps its own stored timeout.
    expect(mergeEditConfig("http_request", { method: "GET", timeoutSeconds: 12 }, built).timeoutSeconds).toBe(12);
  });

  it("does not force GET on website monitors", () => {
    const merged = mergeEditConfig("website", { method: "HEAD", timeoutSeconds: 9 }, { method: "GET", timeoutSeconds: 30, enableSslCheck: true });
    expect(merged).toMatchObject({ method: "HEAD", timeoutSeconds: 9, enableSslCheck: true });
  });

  it("saves legacy configs without keys the validator rejects and clamps timeout", () => {
    const legacy = { ...stored, checkExpiration: true, daysUntilExpirationWarning: 14, checkRevocation: false, sslCheckOnStatusChange: true, responseBodyJsonPath: "$.a", timeoutSeconds: 99999 };
    const merged = mergeEditConfig("website", legacy, { method: "GET", enableSslCheck: true });
    for (const k of ["checkExpiration", "daysUntilExpirationWarning", "checkRevocation", "sslCheckOnStatusChange", "responseBodyJsonPath"]) expect(merged).not.toHaveProperty(k);
    expect(merged.timeoutSeconds).toBe(3600);
    expect(mergeEditConfig("website", { ...stored, timeoutSeconds: 0 }, {}).timeoutSeconds).toBe(1);
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

describe("invalidateDeletedMonitorCaches", () => {
  it("refreshes the list but drops, not refetches, the deleted monitor's own queries", () => {
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const cancel = jest.spyOn(client, "cancelQueries");
    const remove = jest.spyOn(client, "removeQueries");

    invalidateDeletedMonitorCaches(client, "m1");

    const invalidated = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(invalidated.some((key) => key?.includes("m1"))).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledTimes(3);
    for (const [filters] of remove.mock.calls) expect(filters?.queryKey).toContain("m1");
    for (const [filters] of cancel.mock.calls) expect(filters?.queryKey).toContain("m1");
  });

  it("removes cached data for the deleted monitor only", () => {
    const client = new QueryClient();
    const calls: string[] = [];
    jest.spyOn(client, "removeQueries").mockImplementation((filters) => {
      calls.push(JSON.stringify(filters?.queryKey));
    });

    invalidateDeletedMonitorCaches(client, "m1");
    invalidateDeletedMonitorCaches(client, "m2");

    expect(calls.filter((key) => key.includes("m1"))).toHaveLength(3);
    expect(calls.filter((key) => key.includes("m2"))).toHaveLength(3);
  });
});

describe("mergeEditConfig with the AI endpoint preset", () => {
  const ai = { model: "gpt-4o-mini", secretKey: "OPENAI_KEY" };

  it("turning a plain HTTP monitor into the preset drops the request settings and takes the new time limit", () => {
    const stored = { method: "POST", headers: { a: "b" }, body: "x", auth: { type: "bearer", token: "t" }, expectedStatusCodes: "200", keywordInBody: "ok", timeoutSeconds: 12, regions: ["eu"] };
    const merged = mergeEditConfig("http_request", stored, { aiEndpoint: ai, timeoutSeconds: 60 });
    expect(merged).toEqual({ aiEndpoint: ai, timeoutSeconds: 60, regions: ["eu"] });
  });

  it("turning the preset back off removes aiEndpoint and keeps worker state for the server to preserve", () => {
    const merged = mergeEditConfig("http_request", { aiEndpoint: ai, aiEndpointState: { lastServedModel: "m" }, timeoutSeconds: 60 }, { method: "GET", expectedStatusCodes: "200-299", timeoutSeconds: 30 });
    expect(merged).not.toHaveProperty("aiEndpoint");
    expect(merged.timeoutSeconds).toBe(30); // the plain default replaces the preset's stored timeout
  });
});
