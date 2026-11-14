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
  const site = (config: object) => validateMonitorConfiguration({ type: "website", target: "https://example.com", config, incomingConfig: config });
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
  it("does not reject a stored legacy key when the client sent no config", () => {
    expect(
      validateMonitorConfiguration({ type: "website", target: "https://example.com", config: { checkExpiration: true }, incomingConfig: undefined }),
    ).toEqual({ success: true });
  });
  it.each(["FOO", 5, ["GET"], { a: 1 }])("rejects http method %p", (method) => {
    expect(site({ method }).success).toBe(false);
  });
  it.each(["get", "", "PATCH"])("accepts http method %p (the worker upper-cases, blank is GET)", (method) => {
    expect(site({ method }).success).toBe(true);
  });
  it("accepts a spaced range the worker evaluates", () => {
    expect(site({ expectedStatusCodes: "200 - 299" }).success).toBe(true);
  });
  it.each(["abc", "99", "600", "299-200", "2xx,abc", "20x"])("rejects expectedStatusCodes %p", (expectedStatusCodes) => {
    expect(site({ expectedStatusCodes }).success).toBe(false);
  });
  it.each(["200", "200-299", "2xx", "200-299, 301,4xx", "", "2XX", "4Xx"])("accepts expectedStatusCodes %p", (expectedStatusCodes) => {
    expect(site({ method: "POST", expectedStatusCodes }).success).toBe(true);
  });
  it("does not reject a stored legacy method when the client sent no config", () => {
    expect(
      validateMonitorConfiguration({ type: "website", target: "https://example.com", config: { method: "FOO" }, incomingConfig: undefined }),
    ).toEqual({ success: true });
  });
  it("says http(s) for an ftp:// website target", () => {
    expect(validateMonitorConfiguration({ type: "website", target: "ftp://example.com", config: {} })).toMatchObject({
      success: false,
      details: "target must be a valid HTTP or HTTPS URL",
    });
  });
  it("lets a client clear an unsupported key with null", () => {
    expect(site({ responseBodyJsonPath: null })).toEqual({ success: true });
  });
});

describe("target length and control characters", () => {
  const check = (target: string) => validateMonitorConfiguration({ type: "http_request", target, config: {} });
  it("rejects a target over 2048 characters and one with control characters", () => {
    expect(check(`https://example.com/${"a".repeat(2048)}`)).toMatchObject({ success: false });
    expect(check("https://example.com/a\u0000b")).toMatchObject({ success: false });
    expect(check("https://example.com/a\nb")).toMatchObject({ success: false });
  });
  it("accepts a target at the limit", () => {
    expect(check(`https://example.com/${"a".repeat(2048 - 20)}`)).toEqual({ success: true });
  });
});

describe("AI endpoint preset validation", () => {
  const ok = { model: "gpt-4o-mini" };
  const run = (config: Record<string, unknown>, type = "http_request") =>
    validateMonitorConfiguration({ type, target: "https://api.openai.com/v1/chat/completions", config, incomingConfig: config });

  it("accepts a minimal and a full preset", () => {
    expect(run({ aiEndpoint: ok })).toEqual({ success: true });
    expect(
      run({
        timeoutSeconds: 60,
        aiEndpoint: { ...ok, secretKey: "OPENAI_KEY", keyHeader: "x-api-key", prompt: "hi", maxTokens: 512, expectText: "ok", firstTokenTimeoutMs: 500 },
      }),
    ).toEqual({ success: true });
  });

  it("rejects the preset on website monitors", () => {
    expect(run({ aiEndpoint: ok }, "website")).toMatchObject({ success: false, details: expect.stringContaining("http_request") });
  });

  it.each([
    [{}],
    [{ model: "" }],
    [{ model: "x".repeat(201) }],
    [{ ...ok, prompt: "" }],
    [{ ...ok, prompt: "x".repeat(2001) }],
    [{ ...ok, maxTokens: 0 }],
    [{ ...ok, maxTokens: 513 }],
    [{ ...ok, firstTokenTimeoutMs: 499 }],
    [{ ...ok, firstTokenTimeoutMs: 60001 }],
    [{ ...ok, keyHeader: "bad header" }],
    [{ ...ok, keyHeader: "Cookie" }],
    [{ ...ok, secretKey: "" }],
    [{ ...ok, extra: 1 }],
  ])("rejects invalid aiEndpoint %j", (aiEndpoint) => {
    expect(run({ aiEndpoint })).toMatchObject({ success: false, error: "Invalid monitor configuration" });
  });

  it.each([
    [{ method: "POST" }],
    [{ headers: { a: "b" } }],
    [{ body: "x" }],
    [{ keywordInBody: "x" }],
    [{ expectedStatusCodes: "200" }],
    [{ auth: { type: "bearer", token: "t" } }],
  ])("rejects request field %j beside the preset", (extra) => {
    expect(run({ aiEndpoint: ok, ...extra })).toMatchObject({ success: false, details: expect.stringContaining("cannot be set together") });
  });

  it("allows auth type none and rejects a total time limit outside 5-120", () => {
    expect(run({ aiEndpoint: ok, auth: { type: "none" } })).toEqual({ success: true });
    expect(run({ aiEndpoint: ok, timeoutSeconds: 4 })).toMatchObject({ success: false });
    expect(run({ aiEndpoint: ok, timeoutSeconds: 121 })).toMatchObject({ success: false });
  });

  it("validates auth.secretKey shape and exclusivity", () => {
    expect(run({ auth: { type: "bearer", secretKey: "API_TOKEN" } })).toEqual({ success: true });
    expect(run({ auth: { type: "basic", username: "u", secretKey: "PW" } })).toEqual({ success: true });
    expect(run({ auth: { type: "bearer", secretKey: "API_TOKEN", token: "inline" } })).toMatchObject({ success: false });
    expect(run({ auth: { type: "basic", secretKey: "PW", password: "inline" } })).toMatchObject({ success: false });
    expect(run({ auth: { type: "none", secretKey: "PW" } })).toMatchObject({ success: false });
    expect(run({ auth: { type: "bearer", secretKey: "" } })).toMatchObject({ success: false });
  });
});
