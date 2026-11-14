import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { call, mockFetch, redirect } from "./test-helpers";

afterEach(() => vi.restoreAllMocks());

const body = (input = "https://site.com/") => ({ tool: "uptime", input, token: "tok" });
// The real Miniflare rate-limit bindings from wrangler.jsonc.
const real = env as unknown as Env;
const open = { limit: async () => ({ success: true }) } as unknown as RateLimit;
// IP tests leave the per-target bucket open so repeated checks on one site never trip it.
const bindings = { IP_MINUTE: real.IP_MINUTE, IP_BURST: real.IP_BURST, TARGET_MINUTE: open };

describe("per-IP limits", () => {
  it("403s a request without CF-Connecting-IP", async () => {
    const res = await call(body(), { headers: { "cf-connecting-ip": "" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("429s the 4th burst request with retryAfter and Retry-After, before siteverify", async () => {
    const { calls } = mockFetch({ "https://site.com/": new Response("ok") });
    const headers = { "cf-connecting-ip": "203.0.113.200" };
    for (let i = 0; i < 3; i++) expect((await call(body(), { env: bindings, headers })).status).toBe(200);
    const before = calls.filter((c) => c.url.includes("siteverify")).length;
    const res = await call(body(), { env: bindings, headers });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited", retryAfter: 10 });
    expect(res.headers.get("retry-after")).toBe("10");
    expect(calls.filter((c) => c.url.includes("siteverify")).length).toBe(before);
  });

  it("429s the 7th request in a minute (burst bucket open)", async () => {
    mockFetch({ "https://site.com/": new Response("ok") });
    const headers = { "cf-connecting-ip": "203.0.113.201" };
    for (let i = 0; i < 6; i++) expect((await call(body(), { env: { ...bindings, IP_BURST: open }, headers })).status).toBe(200);
    const res = await call(body(), { env: { ...bindings, IP_BURST: open }, headers });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited", retryAfter: 60 });
  });

  it("puts two IPv6 addresses in one /64 into one bucket", async () => {
    mockFetch({ "https://site.com/": new Response("ok") });
    for (const ip of ["2001:db8:aa:1::1", "2001:db8:aa:1::2", "2001:db8:aa:1:ffff::3"]) {
      expect((await call(body(), { env: bindings, headers: { "cf-connecting-ip": ip } })).status).toBe(200);
    }
    expect((await call(body(), { env: bindings, headers: { "cf-connecting-ip": "2001:db8:aa:1::9" } })).status).toBe(429);
    expect((await call(body(), { env: bindings, headers: { "cf-connecting-ip": "2001:db8:aa:2::9" } })).status).toBe(200);
  });
});

describe("per-target limits", () => {
  it("429s the 11th check on one registrable domain from many IPs; subdomains share the bucket", async () => {
    mockFetch({ "https://a1.victim.com/": new Response("ok"), "https://a2.victim.com/": new Response("ok") });
    for (let i = 0; i < 10; i++) {
      const res = await call(body(i % 2 ? "https://a1.victim.com/" : "https://a2.victim.com/"), { env: { TARGET_MINUTE: real.TARGET_MINUTE } });
      expect(res.status).toBe(200);
    }
    const res = await call(body("https://a1.victim.com/"), { env: { TARGET_MINUTE: real.TARGET_MINUTE } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("ends the check limited when a hop host is over its limit", async () => {
    mockFetch({ "https://hopper.com/": redirect("https://busy.com/"), "https://busy.com/": new Response("ok") });
    const limiter = { limit: async ({ key }: { key: string }) => ({ success: key !== "busy.com" }) } as unknown as RateLimit;
    const res = await call(body("https://hopper.com/"), { env: { TARGET_MINUTE: limiter } });
    expect(await res.json()).toMatchObject({ result: { stopped: "limited", reason: "target_rate_limited" } });
  });
});
