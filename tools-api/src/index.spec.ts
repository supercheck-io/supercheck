import { afterEach, describe, expect, it, vi } from "vitest";
import { originAllowed, parseBody } from "./index";
import { call, mockFetch, ORIGIN, testEnv } from "./test-helpers";

afterEach(() => vi.restoreAllMocks());

const ok = (tool = "uptime", input = "https://site.com/") => ({ tool, input, token: "tok" });

describe("routing", () => {
  it("404s unknown paths with a link to the bot page, and GET /", async () => {
    const res = await call(null, { method: "GET", path: "/" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(res.headers.get("link")).toContain("/tools/bot");
  });

  it("405s other methods on /v1/check", async () => {
    expect((await call(null, { method: "GET" })).status).toBe(405);
    expect((await call("x", { method: "PUT" })).status).toBe(405);
  });

  it("answers OPTIONS with 204 and CORS headers", async () => {
    const res = await call(null, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });
});

describe("kill switch", () => {
  it.each([
    [{ CHECKS_ENABLED: "false" }],
    [{ TURNSTILE_SECRET: "" }],
    [{ TOOLS: "" }],
  ])("returns 503 disabled for %o", async (override) => {
    const res = await call(ok(), { env: override });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "disabled" });
  });

  it("returns 503 for a tool that is not in TOOLS", async () => {
    const res = await call(ok("dns", "site.com"), { env: { TOOLS: "uptime" } });
    expect(res.status).toBe(503);
  });
});

describe("body and input", () => {
  it("413s a body over 4 KB, declared or streamed", async () => {
    expect((await call("x".repeat(5000))).status).toBe(413);
  });

  it.each([
    ["{bad", "bad_json"],
    ["[]", "bad_json"],
    [JSON.stringify({ tool: "nope", input: "x", token: "t" }), "unknown_tool"],
    [JSON.stringify({ tool: "uptime", input: "", token: "t" }), "missing_input"],
    [JSON.stringify({ tool: "uptime", input: "x".repeat(2049), token: "t" }), "missing_input"],
    [JSON.stringify({ tool: "uptime", input: "site.com" }), "missing_token"],
    [JSON.stringify({ tool: "uptime", input: "site.com", token: "t", method: "HEAD" }), "bad_method"],
    [JSON.stringify({ tool: "api", input: "site.com", token: "t", method: "POST" }), "bad_method"],
  ])("400s %s", async (body, reason) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input", reason });
  });

  it("accepts a text/plain body and ignores Content-Type", async () => {
    mockFetch({ "https://site.com/": new Response("ok") });
    expect((await call(ok(), { headers: { "content-type": "application/x-anything" } })).status).toBe(200);
  });

  it("400s a URL that fails the policy without spending siteverify", async () => {
    const { calls } = mockFetch();
    const res = await call(ok("uptime", "http://169.254.169.254/"));
    expect(await res.json()).toEqual({ error: "invalid_input", reason: "ip_literal" });
    expect(calls.some((c) => c.url.includes("siteverify"))).toBe(false);
    expect((await call(ok("dns", "localhost"))).status).toBe(400);
  });
});

describe("origin", () => {
  it("403s a missing or foreign Origin before siteverify", async () => {
    const { calls } = mockFetch();
    for (const origin of ["", "https://evil.com", "https://supercheck.io.evil.com"]) {
      const res = await call(ok(), { headers: { origin } });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "origin_not_allowed" });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it("echoes an allowed origin with Vary and never allows credentials", async () => {
    mockFetch({ "https://site.com/": new Response("ok") });
    const res = await call(ok(), { headers: { origin: "https://www.supercheck.io" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://www.supercheck.io");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("allows preview origins only when enabled", () => {
    const e = testEnv({ ALLOWED_ORIGINS: ORIGIN, ALLOW_PREVIEW_ORIGINS: "true" });
    expect(originAllowed("https://abc123.supercheck.pages.dev", e)).toBe(true);
    expect(originAllowed("https://a.b.supercheck.pages.dev", e)).toBe(false);
    expect(originAllowed("https://abc123.supercheck.pages.dev", { ...e, ALLOW_PREVIEW_ORIGINS: "false" })).toBe(false);
  });
});

describe("responses", () => {
  it("is always no-store JSON without Set-Cookie, with colo and checkedAt", async () => {
    mockFetch({ "https://fresh.com/": new Response("ok", { headers: { "set-cookie": "a=b" } }) });
    const res = await call(ok("uptime", "https://fresh.com/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, tool: "uptime", cached: false, result: { up: true } });
    expect(typeof body.checkedAt).toBe("string");
    for (const tool of ["dns", "domain"]) {
      expect((await call(ok(tool, "site.com"), { env: { TOOLS: tool } })).headers.get("cache-control")).toBe("no-store");
    }
  });

  it("returns a stopped result for a host that resolves privately, and an error result on our own failure", async () => {
    mockFetch({}, { "private.com": ["10.0.0.1"] });
    expect(await (await call(ok("uptime", "https://private.com/"))).json()).toMatchObject({ ok: true, result: { stopped: "blocked", reason: "private_address" } });
    vi.restoreAllMocks();
    mockFetch({ "https://data.iana.org": new Response("", { status: 500 }) });
    expect(await (await call(ok("domain", "broken.com"))).json()).toMatchObject({ result: { stopped: "limited", reason: "internal_error" } });
  });

  it("runs every tool through the handler", async () => {
    mockFetch({
      "https://site.com/": new Response("ok"),
      "http://site.com/": new Response("ok"),
      "https://hstspreload.org": Response.json({ status: "unknown" }),
      "https://data.iana.org": Response.json({ services: [] }),
    });
    for (const tool of ["uptime", "api", "https", "headers", "agents", "social"]) {
      expect((await call(ok(tool))).status).toBe(200);
    }
    expect((await call({ ...ok("api"), method: "HEAD" })).status).toBe(200);
    for (const tool of ["dns", "domain"]) expect((await call(ok(tool, "site.com"))).status).toBe(200);
  });
});

describe("parseBody", () => {
  it("defaults the method to GET", () => {
    expect(parseBody(JSON.stringify(ok()), ["uptime"])).toMatchObject({ ok: true, value: { method: "GET" } });
  });
});
