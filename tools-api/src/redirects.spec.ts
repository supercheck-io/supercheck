import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckStop, walk } from "./context";
import { ctxFor, mockFetch, redirect, testEnv } from "./test-helpers";

afterEach(() => vi.restoreAllMocks());

const start = new URL("https://start.com/");

describe("manual redirect walk", () => {
  it("follows relative and absolute Location headers, recording each hop", async () => {
    mockFetch({
      "https://start.com/": redirect("/next"),
      "https://start.com/next": redirect("https://www.final.com/", 302),
      "https://www.final.com/": new Response("ok"),
    });
    const r = await walk(ctxFor("uptime"), start, { maxHops: 5 });
    expect(r.ok).toBe(true);
    expect(r.url.toString()).toBe("https://www.final.com/");
    expect(r.hops).toEqual([
      { host: "start.com", status: 301 },
      { host: "start.com", status: 302 },
    ]);
  });

  it("sends manual redirect mode and the SupercheckBot user agent", async () => {
    const { calls } = mockFetch({ "https://start.com/": new Response("ok") });
    await walk(ctxFor("uptime"), start, { maxHops: 5 });
    const target = calls.find((c) => c.url === "https://start.com/")!;
    expect(target.redirect).toBe("manual");
    expect(target.headers.get("user-agent")).toMatch(/^SupercheckBot\/1\.0 \(\+https:\/\/supercheck\.io\/tools\/bot\)$/);
  });

  it("stops after the hop cap with too_many_redirects", async () => {
    mockFetch({ "https://start.com/": redirect("https://start.com/") });
    const r = await walk(ctxFor("uptime"), start, { maxHops: 3 });
    expect(r).toMatchObject({ ok: false, error: "too_many_redirects" });
    expect(r.hops).toHaveLength(4);
  });

  it.each([
    ["http://127.0.0.1/", "ip_literal"],
    ["http://start.com:8080/", "port"],
    ["http://localhost/", "single_label"],
    ["https://optout.com/", "blocked_host"],
    ["file:///etc/passwd", "scheme"],
    ["http://[", "invalid_url"],
  ])("ends the check blocked_redirect on a hop to %s", async (location, reason) => {
    mockFetch({ "https://start.com/": redirect(location) });
    const ctx = ctxFor("uptime", testEnv({ BLOCKED_HOSTS: "optout.com" }));
    await expect(walk(ctx, start, { maxHops: 5 })).rejects.toMatchObject({ kind: "blocked_redirect", reason });
  });

  it("blocks a hop to a host that resolves privately", async () => {
    mockFetch({ "https://start.com/": redirect("https://rebind.com/") }, { "rebind.com": ["10.0.0.1"] });
    await expect(walk(ctxFor("uptime"), start, { maxHops: 5 })).rejects.toMatchObject({
      kind: "blocked_redirect",
      reason: "private_address",
    });
  });

  it("blocks the first host as blocked, not blocked_redirect", async () => {
    mockFetch({}, { "start.com": ["192.168.1.1"] });
    await expect(walk(ctxFor("uptime"), start, { maxHops: 5 })).rejects.toMatchObject({ kind: "blocked" });
  });

  it("counts every hop host against the per-target limit", async () => {
    mockFetch({ "https://start.com/": redirect("https://victim.com/"), "https://victim.com/": new Response("ok") });
    const keys: string[] = [];
    const limiter = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: key !== "victim.com" }) } as unknown as RateLimit;
    const ctx = ctxFor("uptime", testEnv({ TARGET_MINUTE: limiter }));
    await expect(walk(ctx, start, { maxHops: 5 })).rejects.toMatchObject({ kind: "limited", reason: "target_rate_limited" });
    expect(keys).toEqual(["start.com", "victim.com"]);
  });

  it("cancels the body of every 3xx", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    mockFetch({
      "https://start.com/": () => new Response(body, { status: 301, headers: { location: "/x" } }),
      "https://start.com/x": new Response("ok"),
    });
    await walk(ctxFor("uptime"), start, { maxHops: 5 });
    expect(cancel).toHaveBeenCalled();
  });

  it("treats a 3xx without Location as the final response", async () => {
    mockFetch({ "https://start.com/": new Response(null, { status: 304 }) });
    const r = await walk(ctxFor("uptime"), start, { maxHops: 5 });
    expect(r.ok && r.res.status).toBe(304);
  });

  it("maps a thrown fetch error to a class", async () => {
    mockFetch({ "https://start.com/": () => Promise.reject(new TypeError("SSL certificate error")) });
    const r = await walk(ctxFor("uptime"), start, { maxHops: 5 });
    expect(r).toMatchObject({ ok: false, error: "tls_error" });
  });

  it("lets a CheckStop thrown while fetching escape", async () => {
    mockFetch({ "https://start.com/": () => Promise.reject(new CheckStop("limited", "x")) });
    await expect(walk(ctxFor("uptime"), start, { maxHops: 5 })).rejects.toBeInstanceOf(CheckStop);
  });
});
