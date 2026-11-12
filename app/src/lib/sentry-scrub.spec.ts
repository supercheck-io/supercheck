import { readFileSync } from "fs";
import { join } from "path";
import type { Log, Metric, TransactionEvent } from "@sentry/core";
import {
  isUnsampledPath,
  parseRate,
  resetOwnHostsForTest,
  scrubLog,
  scrubMetric,
  scrubName,
  scrubSpan,
  scrubSpanData,
  scrubString,
  scrubSql,
  scrubTransaction,
  scrubUrl,
} from "./sentry-scrub";

const UUID = "0b5c3a3e-7d6f-4b7e-9d43-1f0e2a3b4c5d";

beforeEach(() => {
  process.env.APP_URL = "https://app.example.io";
  resetOwnHostsForTest();
});

describe("scrubUrl", () => {
  it.each([
    ["https://customer.example.com/orders/42?token=abc#x", "https://[target]"],
    ["https://user:pw@customer.example.com/a", "https://[target]"],
    [
      "https://[2001:db8::1]:8443/customers/john.smith/orders",
      "https://[target]",
    ],
    ["https://shop.acme.com/customers/john.smith/orders", "https://[target]"],
    [
      "https://app.example.io/api/runs/" + UUID,
      "https://app.example.io/api/runs/" + UUID,
    ],
    ["https://api.polar.sh/v1/events", "https://api.polar.sh/v1/events"],
    [
      "http://supercheck-worker:8000/health",
      "http://supercheck-worker:8000/health",
    ],
    ["/invite/abc123", "/invite/[token]"],
    [
      "/api/status-pages/unsubscribe/xyz",
      "/api/status-pages/unsubscribe/[token]",
    ],
    ["/status/custom-domain/status.acme.com", "/status/custom-domain/[token]"],
    ["/reset-password?token=abc", "/reset-password"],
    ["/api/users/bob@example.com", "/api/users/[email]"],
    ["/api/keys/sk_live_abcdefghijklmnopqrstuv", "/api/keys/[token]"],
    ["/bot123456:AAEabcdef/sendMessage", "/[token]/sendMessage"],
    ["/projects/[id]/runs", "/projects/[id]/runs"],
  ])("%s -> %s", (input, expected) => {
    expect(scrubUrl(input)).toBe(expected);
  });
});

describe("scrubName", () => {
  it("scrubs method + path and embedded URLs", () => {
    expect(scrubName("GET /api/invite/secret-token")).toBe(
      "GET /api/invite/[token]",
    );
    expect(scrubName("GET https://customer.example.com/a?b=c")).toBe(
      "GET https://[target]",
    );
    expect(scrubName("render route (app) /status/[id]")).toBe(
      "render route (app) /status/[id]",
    );
  });
});

describe("scrubSql", () => {
  it("keeps placeholders and replaces literals", () => {
    expect(
      scrubSql(
        "select * from users where email = 'a@b.co' and age > 30 and id = $1",
      ),
    ).toBe("select * from users where email = ? and age > ? and id = $1");
    expect(scrubSql("x".repeat(1000)).length).toBe(200);
  });
});

describe("scrubString network errors", () => {
  it.each([
    [
      "getaddrinfo ENOTFOUND api.acme-internal.com",
      "getaddrinfo ENOTFOUND [host]",
    ],
    ["connect ECONNREFUSED 203.0.113.5:443", "connect ECONNREFUSED [ip]"],
    ["Ping to acme.com failed: timeout", "Ping to [host] failed: timeout"],
    ["connect ECONNREFUSED [2001:db8::1]:8443", "connect ECONNREFUSED [ip]"],
    [
      "Hostname/IP does not match certificate's altnames: Host: shop.acme.co.uk",
      "Hostname/IP does not match certificate's altnames: Host: [host]",
    ],
  ])("%s", (input, expected) => {
    expect(scrubString(input)).toBe(expected);
  });

  it("keeps file names and code paths readable", () => {
    expect(
      scrubString(
        "Cannot read x of undefined at monitor.service.ts and JSON.parse in process.env",
      ),
    ).toBe(
      "Cannot read x of undefined at monitor.service.ts and JSON.parse in process.env",
    );
  });
});

describe("scrubSpan", () => {
  it("reduces redis descriptions (op db) to command and key", () => {
    expect(
      scrubSpan({
        op: "db",
        description: 'evalsha abc 1 bull:q:1 {"script":"secret"}',
        data: { "db.system": "redis" },
      }).description,
    ).toBe("evalsha abc");
    expect(
      scrubSpan({
        op: "db",
        description: "get supercheck:login:attempts:alice@example.com",
        data: { "db.system": "redis" },
      }).description,
    ).toBe("get supercheck:login:attempts:[email]");
  });
});

describe("scrubSpanData", () => {
  it("allow-lists attributes and scrubs URLs", () => {
    const out = scrubSpanData({
      "http.request.method": "GET",
      "url.full": "https://customer.example.com/p?q=1",
      "server.address": "customer.example.com",
      "http.request.header.x_api_key": "secret",
      "user_agent.original": "Mozilla",
      "db.statement": "select 1 where name = 'bob'",
      "sentry.op": "http.client",
      runId: UUID,
    });
    expect(out).toEqual({
      "http.request.method": "GET",
      "url.full": "https://[target]",
      "db.statement": "select ? where name = ?",
      "sentry.op": "http.client",
      runId: UUID,
    });
  });

  it("keeps only command and key for redis statements", () => {
    expect(
      scrubSpanData({
        "db.system": "redis",
        "db.statement": 'hset bull:q:1 data {"script":"x"}',
      }),
    ).toEqual({
      "db.system": "redis",
      "db.statement": "hset bull:q:1",
    });
  });
});

describe("scrubTransaction", () => {
  it("scrubs the name, trace data, child spans and drops request data", () => {
    const event = scrubTransaction({
      type: "transaction",
      transaction: "GET /invite/abc",
      request: {
        url: "https://app.example.io/invite/abc",
        headers: { cookie: "c" },
      },
      user: { id: "u1", email: "a@b.co" },
      contexts: {
        trace: {
          trace_id: "t",
          span_id: "s",
          data: { "url.full": "https://app.example.io/invite/abc?x=1" },
        },
        otel: { resource: { "host.name": "pod-1" } },
      },
      spans: [
        {
          span_id: "c",
          trace_id: "t",
          start_timestamp: 0,
          op: "http.client",
          description: "POST https://hooks.customer.io/T000/B000/xyz",
          data: {
            "server.address": "hooks.customer.io",
            "http.response.status_code": 200,
          },
        },
        {
          span_id: "d",
          trace_id: "t",
          start_timestamp: 0,
          op: "db",
          description: "select * from t where a = 'secret'",
          data: {},
        },
      ],
    } as unknown as TransactionEvent) as unknown as Record<string, any>;
    expect(event.transaction).toBe("GET /invite/[token]");
    expect(event.request).toBeUndefined();
    expect(event.user).toEqual({ id: "u1" });
    expect(event.contexts.otel).toBeUndefined();
    expect(event.contexts.trace.data).toEqual({
      "url.full": "https://app.example.io/invite/[token]",
    });
    expect(event.spans[0].description).toBe("POST https://[target]");
    expect(event.spans[0].data).toEqual({ "http.response.status_code": 200 });
    expect(event.spans[1].description).toBe("select * from t where a = ?");
    expect(JSON.stringify(event)).not.toMatch(/customer|secret|a@b\.co|cookie/);
  });
});

describe("scrubLog", () => {
  it("drops debug and trace", () => {
    expect(scrubLog({ level: "debug", message: "x" } as Log)).toBeNull();
    expect(scrubLog({ level: "trace", message: "x" } as Log)).toBeNull();
  });

  it("scrubs the message and keeps allow-listed attributes only", () => {
    const log = scrubLog({
      level: "error",
      message: "Failed for bob@example.com at https://customer.example.com/x",
      attributes: {
        runId: UUID,
        module: "queue",
        "sentry.release": "1.0.0",
        "sentry.message.parameter.0": "bob@example.com",
        "sentry.message.template": "Failed for %s",
        "server.address": "pod-1",
        headers: "x-api-key: secret",
        target: "https://customer.example.com",
      },
    } as unknown as Log)!;
    expect(log.message).toBe("Failed for [email] at [url]");
    expect(log.attributes).toEqual({
      runId: UUID,
      module: "queue",
      "sentry.release": "1.0.0",
    });
  });
});

describe("scrubMetric", () => {
  it("keeps enum/ID attributes only", () => {
    const metric = scrubMetric({
      name: "monitor.check",
      type: "counter",
      value: 1,
      attributes: {
        status: "down",
        cause: "timeout",
        target: "https://customer.example.com",
      },
    } as unknown as Metric)!;
    expect(metric.attributes).toEqual({ status: "down", cause: "timeout" });
  });
});

describe("sampling", () => {
  it.each([
    ["GET /api/health", true],
    ["/health/ready", true],
    ["GET /api/job-status/events/123", true],
    ["GET /api/runs/abc/stream", true],
    ["GET /status/abc", true],
    ["/_next/static/chunk.js", true],
    ["https://app.example.io/api/auth/callback/github?code=x", true],
    ["GET /api/client-config/sentry", true],
    ["GET /api/jobs", false],
    ["POST /api/runs", false],
  ])("isUnsampledPath(%s) = %s", (input, expected) => {
    expect(isUnsampledPath(input)).toBe(expected);
  });

  it("parses rates strictly", () => {
    expect(parseRate("0.2")).toBe(0.2);
    expect(parseRate(undefined)).toBe(0);
    expect(parseRate("")).toBe(0);
    expect(parseRate("2")).toBe(0);
    expect(parseRate("abc", 1)).toBe(1);
  });
});

describe("worker copy", () => {
  // The worker keeps a prettier-formatted copy; compare with formatting normalized.
  const normalize = (src: string) =>
    src
      .replace(/^\/\*\*[\s\S]*?\*\/\n/, "") // header comment differs
      .replace(/^\s*\/\/[^\n]*$/gm, "") // full-line comments only; regexes contain "//"
      .replace(/'/g, '"')
      .replace(/\s+/g, "")
      .replace(/,([)\]}>])/g, "$1")
      .replace(/[()]/g, "");
  it("matches the app module", () => {
    const app = readFileSync(join(__dirname, "sentry-scrub.ts"), "utf8");
    const worker = readFileSync(
      join(__dirname, "../../../worker/src/common/sentry-scrub.ts"),
      "utf8",
    );
    expect(normalize(worker)).toBe(normalize(app));
  });
});
