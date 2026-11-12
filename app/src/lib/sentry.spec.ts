jest.mock("@sentry/node", () => ({
  init: jest.fn(),
  isInitialized: jest.fn(() => false),
  getTraceData: jest.fn(() => ({ "sentry-trace": "t-s-1", baggage: "sentry-environment=test" })),
  captureCheckIn: jest.fn(),
  httpIntegration: jest.fn(() => ({ name: "Http" })),
  nativeNodeFetchIntegration: jest.fn(() => ({ name: "NodeFetch" })),
  pinoIntegration: jest.fn(() => ({ name: "Pino" })),
  consoleLoggingIntegration: jest.fn(() => ({ name: "ConsoleLogging" })),
  captureException: jest.fn(),
  close: jest.fn().mockResolvedValue(true),
  onUnhandledRejectionIntegration: jest.fn(() => ({
    name: "OnUnhandledRejection",
  })),
}));

import * as Sentry from "@sentry/node";
import {
  captureCheckIn,
  getTraceHeaders,
  getSentryOptions,
  initSentry,
  scrubEvent,
  scrubString,
} from "./sentry";

const DSN = "https://abc@o1.ingest.sentry.io/1";

describe("enable gate", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    jest.clearAllMocks();
  });

  it("is off without a DSN", () => {
    expect(getSentryOptions({}, false)).toBeNull();
    expect(getSentryOptions({ SENTRY_DSN: "  " }, false)).toBeNull();
  });

  it("is off when self-hosted even with a DSN", () => {
    expect(getSentryOptions({ SENTRY_DSN: DSN }, true)).toBeNull();
  });

  it("initSentry does not call Sentry.init when gated off", () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = "true";
    expect(initSentry()).toBe(false);
    delete process.env.SENTRY_DSN;
    process.env.SELF_HOSTED = "false";
    expect(initSentry()).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("inits privately on cloud with a DSN", () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = "false";
    process.env.SENTRY_RELEASE = "1.2.3";
    expect(initSentry()).toBe(true);
    const opts = (Sentry.init as jest.Mock).mock.calls[0][0];
    expect(opts.release).toBe("1.2.3");
    expect(opts.tracesSampleRate).toBeUndefined();
    expect(opts.sendDefaultPii).toBe(false);
    expect(opts.includeLocalVariables).toBe(false);
    expect(opts.beforeBreadcrumb({ message: "x" })).toBeNull();
    const names = opts
      .integrations([
        { name: "Console" },
        { name: "RequestData" },
        { name: "LocalVariablesAsync" },
        { name: "ProcessSession" },
        { name: "OnUnhandledRejection" },
        { name: "Dedupe" },
      ])
      .map((i: { name: string }) => i.name);
    expect(names).toEqual(["Dedupe", "OnUnhandledRejection", "Http", "NodeFetch"]);
    expect(opts.tracesSampler).toBeUndefined(); // no rate: tracing fully off
    expect(opts.enableLogs).toBe(false);
    // warn: Next's own listener keeps the app alive on stray rejections; strict would exit the pod.
    expect(Sentry.onUnhandledRejectionIntegration).toHaveBeenCalledWith({
      mode: "warn",
    });
  });
});

describe('scrubString', () => {
  it.each([
    ['Bearer abc.def-123', 'abc.def'],
    ['password=hunter2', 'hunter2'],
    ['api_key: sk_live_abc', 'sk_live_abc'],
    ['mail bob@example.com now', 'bob@example.com'],
    ['postgres://u:pw@db:5432/x', 'pw@db'],
    ['GET https://a.test/p?token=abc&x=1 failed', 'token=abc'],
    ['{"password":"hunter2"}', 'hunter2'],
    ["{'token': 'tok123'}", 'tok123'],
    ['"apiKey" : "k-9999"', 'k-9999'],
    ['Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['Authorization: Bearer abc123xyz', 'abc123xyz'],
    ['Authorization: Digest user=bob nonce=zzz', 'zzz'],
    ['Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA'],
    ['Cookie: a=1; sid=zzz; b=2\nnext', 'sid=zzz'],
    ['Set-Cookie: sid=abc; Path=/; HttpOnly', 'Path=/'],
    ['locator(\'#login-secret-box\') not found', 'login-secret-box'],
    ['expected "Welcome back Alice" to be visible', 'Alice'],
    ['page.fill(`input[name=ssn]`, 1)', 'ssn'],
    ['unterminated "leaky text here', 'leaky'],
  ])('redacts %s', (input, leaked) => {
    expect(scrubString(input)).not.toContain(leaked);
  });

  it('redacts Drizzle params and shortens the SQL', () => {
    const sql = `select ${'col, '.repeat(60)} from users where email = $1`;
    const out = scrubString(`Failed query: ${sql}\nparams: bob@x.test,pw123`);
    expect(out).toContain('params: [redacted]');
    expect(out).not.toContain('bob@x.test');
    expect(out).not.toContain('pw123');
    expect(out.length).toBeLessThanOrEqual(240);
  });

  it('keeps canonical UUIDs readable but redacts other long tokens', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(scrubString(`run ${uuid} failed`)).toBe(`run ${uuid} failed`);
    expect(scrubString(`id ${'a1b2'.repeat(10)} x`)).toBe('id [redacted] x');
  });

  it('caps length', () => {
    expect(scrubString('a b '.repeat(500)).length).toBeLessThanOrEqual(503);
  });

  it.each([
    'key-',
    'token-',
    'a@',
    'http://',
    'password:',
    '"',
    "'",
    'Bearer ',
    'cookie:',
    'a'.repeat(7),
    ' ',
  ])('scrubs a 100 KB adversarial input (%j) quickly', (unit) => {
    const input = unit.repeat(Math.ceil(100_000 / unit.length));
    const start = performance.now();
    scrubString(input);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("scrubEvent", () => {
  it("drops request, extra, breadcrumbs and unsafe context, keeps allowed fields", () => {
    const event = scrubEvent<Sentry.ErrorEvent>({
      type: undefined,
      request: { url: "https://x.test/a?b=1", headers: { cookie: "s" } },
      extra: { script: "secret" },
      breadcrumbs: [{ message: "log" }],
      server_name: "host",
      user: { id: "u1", email: "a@b.co", ip_address: "1.1.1.1" },
      contexts: {
        runtime: { name: "node" },
        os: { name: "linux" },
        app: { x: 1 },
      },
      tags: { organizationId: "o1", testName: "My test", runId: "r1" },
      exception: {
        values: [
          {
            value: "failed for a@b.co with password=abc",
            stacktrace: {
              frames: [{ filename: "f", vars: { a: 1 }, context_line: "x" }],
            },
          },
        ],
      },
    }) as unknown as Record<string, any>;
    expect(event.request).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.user).toEqual({ id: "u1" });
    expect(Object.keys(event.contexts)).toEqual(["runtime", "os"]);
    expect(event.tags).toEqual({ organizationId: "o1", runId: "r1" });
    expect(event.exception.values[0].value).toBe(
      "failed for [email] with password=[redacted]",
    );
    expect(event.exception.values[0].stacktrace.frames[0]).toEqual({
      filename: "f",
    });
  });
});

describe("sentry-gate", () => {
  it("does not import the SDK module", () => {
    const src = require("fs").readFileSync(require.resolve("./sentry-gate"), "utf8");
    expect(src).not.toMatch(/from\s+["']@sentry\//);
  });
});

describe("tracing, logs and check-ins", () => {
  const opts = (env: Record<string, string>) => getSentryOptions({ SENTRY_DSN: DSN, ...env }, false)!;

  it("samples at the env rate but never health, stream, status or auth routes", () => {
    const sampler = opts({ SENTRY_TRACES_SAMPLE_RATE: "0.25" }).tracesSampler!;
    const ctx = (name: string) =>
      ({ name, inheritOrSampleWith: (rate: number) => rate, normalizedRequest: undefined }) as unknown as Parameters<typeof sampler>[0];
    expect(sampler(ctx("GET /api/jobs"))).toBe(0.25);
    for (const name of ["GET /api/health", "GET /api/job-status/events", "GET /status/abc", "GET /api/auth/callback/x"]) {
      expect(sampler(ctx(name))).toBe(0);
    }
    expect(opts({ SENTRY_TRACES_SAMPLE_RATE: "0.25" }).tracePropagationTargets).toEqual([]);
  });

  it("adds log integrations only when logs are enabled", () => {
    const names = (env: Record<string, string>) =>
      (opts(env).integrations as (d: { name: string }[]) => { name: string }[])([]).map((i) => i.name);
    expect(names({})).not.toContain("Pino");
    expect(names({ SENTRY_ENABLE_LOGS: "true" })).toEqual(expect.arrayContaining(["Pino", "ConsoleLogging"]));
    expect(opts({ SENTRY_ENABLE_LOGS: "true" }).enableLogs).toBe(true);
  });

  it("exposes trace headers and sends check-ins with a monitor config", () => {
    expect(getTraceHeaders()).toEqual({ sentryTrace: "t-s-1", baggage: "sentry-environment=test" });
    captureCheckIn("usage-sync", { type: "interval", value: 5, unit: "minute" }, "error", 1.5);
    expect(Sentry.captureCheckIn).toHaveBeenCalledWith(
      { monitorSlug: "usage-sync", status: "error", duration: 1.5 },
      expect.objectContaining({ schedule: { type: "interval", value: 5, unit: "minute" }, checkinMargin: 2 }),
    );
  });
});
