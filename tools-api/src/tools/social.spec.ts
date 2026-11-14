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
