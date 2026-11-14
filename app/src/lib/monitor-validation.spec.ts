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

  it("requires https when a project secret is sent, unless internal targets are allowed", () => {
    const http = (config: Record<string, unknown>) =>
      validateMonitorConfiguration({ type: "http_request", target: "http://api.example.com/v1/chat/completions", config, incomingConfig: config });
    expect(http({ aiEndpoint: { ...ok, secretKey: "KEY" } })).toMatchObject({ success: false, details: expect.stringContaining("https") });
    expect(http({ auth: { type: "bearer", secretKey: "KEY" } })).toMatchObject({ success: false });
    for (const target of ["http:api.example.com/v1/chat/completions", "http:/api.example.com/v1", "HTTP://api.example.com/v1"]) {
      expect(
        validateMonitorConfiguration({ type: "http_request", target, config: { aiEndpoint: { ...ok, secretKey: "KEY" } }, incomingConfig: {} }),
      ).toMatchObject({ success: false });
    }
    expect(http({ aiEndpoint: ok })).toEqual({ success: true });
    process.env.ALLOW_INTERNAL_TARGETS = "true";
    try {
      expect(http({ aiEndpoint: { ...ok, secretKey: "KEY" } })).toEqual({ success: true });
    } finally {
      delete process.env.ALLOW_INTERNAL_TARGETS;
    }
  });

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

  it("needs an explicit bearer or basic type, and a username for basic, with auth.secretKey", () => {
    expect(run({ auth: { secretKey: "API_TOKEN" } })).toMatchObject({ success: false, details: expect.stringContaining("bearer or basic") });
    expect(run({ auth: { type: "digest", secretKey: "API_TOKEN" } })).toMatchObject({ success: false });
    expect(run({ auth: { type: "basic", secretKey: "PW" } })).toMatchObject({ success: false, details: expect.stringContaining("username") });
    expect(run({ auth: { type: "basic", username: "  ", secretKey: "PW" } })).toMatchObject({ success: false });
  });

  it("keeps the first token limit within the total timeout (default 60 s)", () => {
    expect(run({ aiEndpoint: { ...ok, firstTokenTimeoutMs: 60000 } })).toEqual({ success: true });
    expect(run({ aiEndpoint: { ...ok, firstTokenTimeoutMs: 10001 }, timeoutSeconds: 10 })).toMatchObject({ success: false, details: expect.stringContaining("firstTokenTimeoutMs") });
    expect(run({ aiEndpoint: { ...ok, firstTokenTimeoutMs: 10000 }, timeoutSeconds: 10 })).toEqual({ success: true });
  });
});

describe("MCP monitor validation (B12)", () => {
  const url = "https://mcp.example.com/mcp";
  const base = { auth: { type: "none" as const } };
  const mcp = (config: Record<string, unknown>, target: string = url) =>
    validateMonitorConfiguration({ type: "mcp_server", target, config, incomingConfig: config });
  const restore = process.env.ALLOW_INTERNAL_TARGETS;
  afterEach(() => {
    if (restore === undefined) delete process.env.ALLOW_INTERNAL_TARGETS;
    else process.env.ALLOW_INTERNAL_TARGETS = restore;
  });

  it("accepts a minimal and a full config", () => {
    expect(mcp({ mcp: base })).toEqual({ success: true });
    expect(
      mcp({
        mcp: {
          auth: { type: "header", secretKey: "TOKEN", headerName: "X-Api-Key" },
          protocol: "2026",
          requiredTools: ["search_docs", "ns.tool:v1"],
          toolCall: { name: "search_docs", arguments: { q: "x" }, expectText: "ok" },
          slowMs: 2000,
        },
        timeoutSeconds: 45,
      }),
    ).toEqual({ success: true });
    expect(mcp({ mcp: { auth: { type: "bearer", secretKey: "TOKEN" } } })).toEqual({ success: true });
  });

  it.each([
    ["http scheme", "http://mcp.example.com/mcp"],
    ["ftp scheme", "ftp://mcp.example.com/mcp"],
    ["credentials", "https://user:pw@mcp.example.com/mcp"],
    ["username only", "https://user@mcp.example.com/mcp"],
    ["fragment", "https://mcp.example.com/mcp#access_token=x"],
    ["not a URL", "mcp.example.com"],
  ])("rejects a target with %s", (_name, target) => {
    expect(mcp({ mcp: base }, target)).toMatchObject({ success: false, error: "Invalid monitor target" });
  });

  it("allows http only with ALLOW_INTERNAL_TARGETS=true", () => {
    process.env.ALLOW_INTERNAL_TARGETS = "true";
    expect(mcp({ mcp: base }, "http://mcp.internal/mcp")).toEqual({ success: true });
    expect(mcp({ mcp: base }, "https://user:pw@mcp.internal/mcp")).toMatchObject({ success: false });
  });

  it.each([
    ["missing mcp", {}],
    ["unknown key", { mcp: { ...base, extra: 1 } }],
    ["bad login type", { mcp: { auth: { type: "basic" } } }],
    ["bearer without secret", { mcp: { auth: { type: "bearer" } } }],
    ["header without secret", { mcp: { auth: { type: "header", headerName: "X-Key" } } }],
    ["header without name", { mcp: { auth: { type: "header", secretKey: "T" } } }],
    ["bearer with header name", { mcp: { auth: { type: "bearer", secretKey: "T", headerName: "X-Key" } } }],
    ["none with secret", { mcp: { auth: { type: "none", secretKey: "T" } } }],
    ["forbidden header", { mcp: { auth: { type: "header", secretKey: "T", headerName: "Host" } } }],
    ["bad header name", { mcp: { auth: { type: "header", secretKey: "T", headerName: "X Key" } } }],
    ["empty secret name", { mcp: { auth: { type: "bearer", secretKey: " " } } }],
    ["unknown protocol", { mcp: { ...base, protocol: "2024" } }],
    ["51 required tools", { mcp: { ...base, requiredTools: Array.from({ length: 51 }, (_, i) => `t${i}`) } }],
    ["tool name with space", { mcp: { ...base, requiredTools: ["bad name"] } }],
    ["tool name over 128 chars", { mcp: { ...base, requiredTools: ["a".repeat(129)] } }],
    ["tool call without name", { mcp: { ...base, toolCall: {} } }],
    ["arguments array", { mcp: { ...base, toolCall: { name: "t", arguments: [1] } } }],
    ["arguments over 8 KiB", { mcp: { ...base, toolCall: { name: "t", arguments: { big: "x".repeat(8200) } } } }],
    ["expectText over 500", { mcp: { ...base, toolCall: { name: "t", expectText: "x".repeat(501) } } }],
    ["slowMs under 100", { mcp: { ...base, slowMs: 99 } }],
    ["slowMs over 60000", { mcp: { ...base, slowMs: 60001 } }],
    ["timeout under 5", { mcp: base, timeoutSeconds: 4 }],
    ["timeout over 60", { mcp: base, timeoutSeconds: 61 }],
  ])("rejects %s", (_name, config) => {
    expect(mcp(config)).toMatchObject({ success: false, error: "Invalid monitor configuration" });
  });

  it("accepts the boundaries", () => {
    expect(mcp({ mcp: { ...base, slowMs: 100, requiredTools: Array.from({ length: 50 }, (_, i) => `t${i}`), toolCall: { name: "a".repeat(128), expectText: "x".repeat(500) } }, timeoutSeconds: 5 })).toEqual({ success: true });
    expect(mcp({ mcp: { ...base, slowMs: 60000 }, timeoutSeconds: 60 })).toEqual({ success: true });
  });

  it("allows config.mcp only on mcp_server monitors", () => {
    expect(validateMonitorConfiguration({ type: "http_request", target: "https://example.com", config: { mcp: base } })).toMatchObject({
      success: false,
      details: "config.mcp is only supported on mcp_server monitors",
    });
    expect(validateMonitorConfiguration({ type: "http_request", target: "https://example.com", config: {} })).toEqual({ success: true });
  });

  it("limits the AI endpoint warning fields", () => {
    const http = (aiEndpoint: Record<string, unknown>) =>
      validateMonitorConfiguration({ type: "http_request", target: "https://api.example.com/v1", config: { aiEndpoint: { model: "m", ...aiEndpoint } } });
    expect(http({ warnFirstTokenMs: 100, warnTotalTokens: 1_000_000 })).toEqual({ success: true });
    expect(http({ warnFirstTokenMs: 99 })).toMatchObject({ success: false });
    expect(http({ warnFirstTokenMs: 60001 })).toMatchObject({ success: false });
    expect(http({ warnTotalTokens: 0 })).toMatchObject({ success: false });
    expect(http({ warnTotalTokens: 1_000_001 })).toMatchObject({ success: false });
  });
});
