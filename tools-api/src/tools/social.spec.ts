import { afterEach, describe, expect, it, vi } from "vitest";
import { social } from "./social";
import { ctxFor, mockFetch, redirect, testEnv } from "../test-helpers";

afterEach(() => vi.restoreAllMocks());

type Ok = Exclude<Awaited<ReturnType<typeof social>>, { error: string }>;
const run = async (...a: Parameters<typeof social>) => (await social(...a)) as Ok;
const page = (head: string) => new Response(`<!doctype html><html><head>${head}</head><body>x</body></html>`, { headers: { "content-type": "text/html" } });
const FULL = `<title> My site </title>
<meta name="description" content="Desc">
<meta property="og:title" content="OG T"><meta property="og:description" content="OG D">
<meta property="og:image" content="/img.png"><meta property="og:url" content="https://site.com/"><meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="TT">
<meta name="twitter:description" content="TD"><meta name="twitter:image" content="https://site.com/img.png">`;

describe("social tool", () => {
  it("extracts OG, Twitter, title and description, resolves a relative og:image and HEADs it", async () => {
    const { calls } = mockFetch({
      "https://site.com/page": page(FULL),
      "https://site.com/img.png": new Response(null, { headers: { "content-type": "image/png", "content-length": "1234" } }),
    });
    const r = await run(ctxFor("social"), new URL("https://site.com/page"));
    expect(r).toMatchObject({ title: "My site", description: "Desc", missing: [] });
    expect(r.tags?.["og:title"]).toBe("OG T");
    expect(r.image).toMatchObject({ url: "https://site.com/img.png", reachable: true, contentType: "image/png", bytes: 1234, loadable: true });
    expect(calls.find((c) => c.url === "https://site.com/img.png")?.method).toBe("HEAD");
  });

  it("caps text values at 300 characters and lists missing tags", async () => {
    mockFetch({ "https://site.com/": page(`<meta property="og:title" content="${"t".repeat(500)}">`) });
    const r = await run(ctxFor("social"), new URL("https://site.com/"));
    expect(r.tags?.["og:title"]).toHaveLength(300);
    expect(r.missing).toContain("og:image");
    expect(r.image).toBeNull();
  });

  it("keeps a long signed og:image URL intact", async () => {
    const long = `https://cdn.site.com/i.png?sig=${"a".repeat(600)}`;
    const { calls } = mockFetch({
      "https://site.com/": page(`<meta property="og:image" content="${long}">`),
      "https://cdn.site.com/i.png": new Response(null, { headers: { "content-type": "image/png" } }),
    });
    const r = await run(ctxFor("social"), new URL("https://site.com/"));
    expect(r.image).toMatchObject({ url: long, reachable: true });
    expect(calls.some((c) => c.url === long)).toBe(true);
  });

  it("falls back to a one-byte GET when the CDN refuses HEAD, and names an HTTP failure", async () => {
    const { calls } = mockFetch({
      "https://site.com/": page(`<meta property="og:image" content="https://cdn.site.com/i.png">`),
      "https://cdn.site.com/i.png": (req) =>
        req.method === "HEAD" ? new Response(null, { status: 405 }) : new Response("x", { status: 206, headers: { "content-type": "image/png" } }),
    });
    expect((await run(ctxFor("social"), new URL("https://site.com/"))).image).toMatchObject({ reachable: true, bytes: null });
    expect(calls.find((c) => c.method === "GET" && c.url.endsWith("i.png"))?.headers.get("range")).toBe("bytes=0-0");
    vi.restoreAllMocks();
    mockFetch({
      "https://site.com/": page(`<meta property="og:image" content="https://cdn.site.com/i.png">`),
      "https://cdn.site.com/i.png": new Response(null, { status: 404 }),
    });
    expect((await run(ctxFor("social"), new URL("https://site.com/"))).image).toMatchObject({ reachable: false, reason: "http_404" });
  });

  it("reads the full image size from content-range after the ranged GET", async () => {
    mockFetch({
      "https://site.com/": page(`<meta property="og:image" content="https://cdn.site.com/i.png">`),
      "https://cdn.site.com/i.png": (req) =>
        req.method === "HEAD"
          ? new Response(null, { status: 405 })
          : new Response("x", { status: 206, headers: { "content-type": "image/png", "content-length": "1", "content-range": "bytes 0-0/48213" } }),
    });
    expect((await run(ctxFor("social"), new URL("https://site.com/"))).image).toMatchObject({ bytes: 48213 });
  });

  it("keeps the tags when the image check runs out of time", async () => {
    const ctx = ctxFor("social");
    ctx.deadlineAt = Date.now() + 5_000;
    mockFetch({
      // The page answers, then the clock runs out before the image check.
      "https://site.com/": () => ((ctx.deadlineAt = 0), page(`<meta property="og:title" content="T"><meta property="og:image" content="https://cdn.site.com/i.png">`)),
    });
    const r = await run(ctx, new URL("https://site.com/"));
    expect(r.tags?.["og:title"]).toBe("T");
    expect(r.image).toMatchObject({ reachable: false, reason: "timeout" });
  });

  it("decodes character references in tag values", async () => {
    const { calls } = mockFetch({
      "https://site.com/": page(`<meta property="og:title" content="A &amp; B &#8212; C"><meta property="og:image" content="/i.png?w=1&amp;sig=abc">`),
      "https://site.com/i.png": new Response(null, { headers: { "content-type": "image/png" } }),
    });
    const r = await run(ctxFor("social"), new URL("https://site.com/"));
    expect(r.tags?.["og:title"]).toBe("A & B \u2014 C");
    expect(calls.some((c) => c.url === "https://site.com/i.png?w=1&sig=abc")).toBe(true);
  });

  it("marks an image that redirects from https to http as not loadable", async () => {
    mockFetch({
      "https://site.com/": page(`<meta property="og:image" content="https://cdn.site.com/i.png">`),
      "https://cdn.site.com/i.png": redirect("http://cdn.site.com/i.png"),
      "http://cdn.site.com/i.png": new Response(null, { headers: { "content-type": "image/png" } }),
    });
    expect((await run(ctxFor("social"), new URL("https://site.com/"))).image).toMatchObject({ reachable: true, loadable: false });
  });

  it("flags a non-image content type", async () => {
    mockFetch({
      "https://site.com/": page(`<meta property="og:image" content="https://site.com/i">`),
      "https://site.com/i": new Response(null, { headers: { "content-type": "text/html" } }),
    });
    expect((await run(ctxFor("social"), new URL("https://site.com/"))).image).toMatchObject({ reachable: false, reason: "not_an_image" });
  });

  it("does not report an og:image reachable when it is blocked by policy or a redirect", async () => {
    mockFetch({
      "https://site.com/": page(`<meta property="og:image" content="https://cdn.site.com/i.png">`),
      "https://cdn.site.com/i.png": redirect("http://127.0.0.1/i.png"),
    });
    expect((await run(ctxFor("social"), new URL("https://site.com/"))).image).toMatchObject({
      reachable: false,
      reason: "ip_literal",
      loadable: false,
    });
    vi.restoreAllMocks();
    mockFetch({ "https://site.com/": page(`<meta property="og:image" content="https://optout.com/i.png">`) });
    const ctx = ctxFor("social", testEnv({ BLOCKED_HOSTS: "optout.com" }));
    expect((await run(ctx, new URL("https://site.com/"))).image).toMatchObject({ reachable: false, reason: "blocked_host" });
  });

  it("marks an http image as not loadable in the browser", async () => {
    mockFetch({
      "https://site.com/": page(`<meta property="og:image" content="http://site.com/i.png">`),
      "http://site.com/i.png": new Response(null, { headers: { "content-type": "image/png" } }),
    });
    expect((await run(ctxFor("social"), new URL("https://site.com/"))).image).toMatchObject({ reachable: true, loadable: false });
  });

  it("reports an unreachable page and an unreachable image", async () => {
    mockFetch({ "https://site.com/": () => Promise.reject(new Error("reset")) });
    expect(await social(ctxFor("social"), new URL("https://site.com/"))).toMatchObject({ error: "connection_failed" });
    vi.restoreAllMocks();
    mockFetch({
      "https://site.com/": page(`<meta property="og:image" content="https://site.com/i.png">`),
      "https://site.com/i.png": () => Promise.reject(new Error("reset")),
    });
    expect((await run(ctxFor("social"), new URL("https://site.com/"))).image).toMatchObject({ reachable: false, reason: "connection_failed" });
  });
});
