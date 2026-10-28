import { validateMonitorConfiguration } from "./monitor-validation";

describe("validateMonitorConfiguration", () => {
  it.each(["2001:4860:4860::8888", "2606:4700:4700::1111"])("accepts IPv6 target %s while worker SSRF remains authoritative", (target) => {
    expect(validateMonitorConfiguration({ type: "port_check", target, config: { port: 443, protocol: "tcp" } })).toEqual({ success: true });
  });
  it.each([1, 443, 65535])("accepts valid port %i", (port) => {
    expect(
      validateMonitorConfiguration({
        type: "port_check",
        target: "example.com",
        config: { port, protocol: "tcp", timeoutSeconds: 10 },
      }),
    ).toEqual({ success: true });
  });

  it.each([0, 65536, 1.5, "443", null])("rejects invalid port %p", (port) => {
    expect(
      validateMonitorConfiguration({
        type: "port_check",
        target: "example.com",
        config: { port, protocol: "tcp" },
      }),
    ).toMatchObject({ success: false, error: "Invalid monitor configuration" });
  });

  it.each(["TCP", "http", "", undefined])("rejects protocol %p", (protocol) => {
    expect(
      validateMonitorConfiguration({
        type: "port_check",
        target: "example.com",
        config: { port: 443, protocol },
      }),
    ).toMatchObject({ success: false });
  });

  it("rejects invalid type, target, timeout, SSL warning days, and synthetic ID", () => {
    const cases = [
      { type: "unknown", target: "example.com", config: {} },
      { type: "website", target: "javascript:alert(1)", config: {} },
      { type: "ping_host", target: "bad host", config: {} },
      {
        type: "ping_host",
        target: "example.com",
        config: { timeoutSeconds: 0 },
      },
      {
        type: "website",
        target: "https://example.com",
        config: { sslDaysUntilExpirationWarning: 366 },
      },
      { type: "synthetic_test", target: "", config: { testId: "not-a-uuid" } },
    ];

    for (const input of cases) {
      expect(validateMonitorConfiguration(input)).toMatchObject({
        success: false,
      });
    }
  });
});

describe("location policy and unsupported assertions", () => {
  const site = (config: object) => validateMonitorConfiguration({ type: "website", target: "https://example.com", config });
  const locations = (extra: object) => ({ locationConfig: { enabled: true, locations: ["eu-central"], threshold: 50, strategy: "majority", ...extra } });

  it.each([0, -1, 101, 50.5, "50"])("rejects locationConfig.threshold %p (c17)", (threshold) => {
    expect(site(locations({ threshold })).success).toBe(false);
  });
  it("rejects an unknown strategy (c17)", () => {
    expect(site(locations({ strategy: "most" })).success).toBe(false);
  });
  it.each([1, 50, 100])("accepts threshold %p", (threshold) => {
    expect(site(locations({ threshold }))).toEqual({ success: true });
  });
  it.each(["responseBodyJsonPath", "checkExpiration", "daysUntilExpirationWarning", "checkRevocation", "sslCheckOnStatusChange"])(
    "rejects %s, which no probe evaluates (c15)",
    (key) => {
      expect(site({ [key]: { path: "$.a", expectedValue: 1 } }).success).toBe(false);
    },
  );
  it("lets a client clear an unsupported key with null", () => {
    expect(site({ responseBodyJsonPath: null })).toEqual({ success: true });
  });
});
