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
