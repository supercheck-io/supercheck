import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheKey } from "./cache";
import { call, mockFetch } from "./test-helpers";

afterEach(() => vi.restoreAllMocks());

describe("cache", () => {
  it("serves a second identical check from cache without target fetches", async () => {
    const { targets } = mockFetch({ "https://cached.com/": new Response("ok") });
    const first = (await (await call({ tool: "uptime", input: "https://cached.com/#a", token: "t" })).json()) as Record<string, unknown>;
    expect(first.cached).toBe(false);
    const fetched = targets().length;
    const second = (await (await call({ tool: "uptime", input: "https://cached.com/#b", token: "t" })).json()) as Record<string, unknown>;
    expect(second.cached).toBe(true);
    expect(second.checkedAt).toBe(first.checkedAt);
    expect(targets().length).toBe(fetched);
  });

  it("uses distinct GET keys for HEAD and GET", async () => {
    const get = await cacheKey("api", "GET", "https://x.com/");
    const head = await cacheKey("api", "HEAD", "https://x.com/");
    expect(get.url).not.toBe(head.url);
    expect(head.method).toBe("GET");
    expect(head.url).toMatch(/^https:\/\/cache\.invalid\/v1\/api\/HEAD\/[0-9a-f]{64}$/);
  });

  it("never caches a partial result (an absorbed stop)", async () => {
    mockFetch({
      "https://partial.com/": new Response('<head><meta property="og:image" content="https://img.partial.com/i.png"></head>', { headers: { "content-type": "text/html" } }),
    }, { "img.partial.com": ["10.0.0.1"] });
    const first = (await (await call({ tool: "social", input: "https://partial.com/", token: "t" })).json()) as { result: { image: { reason: string } } };
    expect(first.result.image.reason).toBe("private_address");
    const again = (await (await call({ tool: "social", input: "https://partial.com/", token: "t" })).json()) as Record<string, unknown>;
    expect(again.cached).toBe(false);
  });

  it("turns the deadline into a stopped result that is not cached", async () => {
    const { ctxFor } = await import("./test-helpers");
    const { walk } = await import("./context");
    const ctl = new AbortController();
    const ctx = ctxFor("uptime");
    Object.defineProperty(ctx, "signal", { value: ctl.signal });
    mockFetch({ "https://slow.com/": () => (ctl.abort(), Promise.reject(new DOMException("x", "AbortError"))) });
    await expect(walk(ctx, new URL("https://slow.com/"), { maxHops: 1 })).rejects.toMatchObject({ kind: "limited", reason: "deadline" });
    expect(ctx.degraded).toBe(true);
  });

  it("never caches a stopped or failed check", async () => {
    mockFetch({}, { "nocache.com": ["10.0.0.1"] });
    await call({ tool: "uptime", input: "https://nocache.com/", token: "t" });
    vi.restoreAllMocks();
    mockFetch({ "https://nocache.com/": new Response("ok") });
    const again = (await (await call({ tool: "uptime", input: "https://nocache.com/", token: "t" })).json()) as Record<string, unknown>;
    expect(again.cached).toBe(false);
  });
});
