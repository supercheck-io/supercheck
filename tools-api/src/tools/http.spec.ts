import { afterEach, describe, expect, it, vi } from "vitest";
import { api, headers, uptime } from "./http";
import { ctxFor, mockFetch, redirect } from "../test-helpers";

afterEach(() => vi.restoreAllMocks());

const u = new URL("https://site.com/");

describe("uptime", () => {
  it("is up on 2xx after redirects and reports hops, final URL and server", async () => {
    mockFetch({ "https://site.com/": redirect("https://www.site.com/"), "https://www.site.com/": new Response("ok", { headers: { server: "nginx" } }) });
    expect(await uptime(ctxFor("uptime"), u)).toMatchObject({
      up: true,
      status: 200,
      finalUrl: "https://www.site.com/",
      hops: [{ host: "site.com", status: 301 }],
      server: "nginx",
    });
  });

  it("is down on 5xx, on 304 and on too many redirects", async () => {
    mockFetch({ "https://site.com/": new Response("x", { status: 503 }) });
    expect(await uptime(ctxFor("uptime"), u)).toMatchObject({ up: false, status: 503 });
    vi.restoreAllMocks();
    mockFetch({ "https://site.com/": redirect("https://site.com/") });
    expect(await uptime(ctxFor("uptime"), u)).toMatchObject({ up: false, error: "too_many_redirects" });
  });
});

describe("api", () => {
  it("validates JSON when the content type is json", async () => {
    mockFetch({ "https://site.com/": Response.json({ a: 1 }, { headers: { "access-control-allow-origin": "*", "cache-control": "no-cache" } }) });
    expect(await api(ctxFor("api"), u, "GET")).toMatchObject({ responding: true, json: "valid", cors: "*", cacheControl: "no-cache" });
  });

  it("reports invalid JSON, not JSON, truncated bodies and HEAD", async () => {
    mockFetch({ "https://site.com/": new Response("{bad", { headers: { "content-type": "application/json" } }) });
    expect((await api(ctxFor("api"), u, "GET")).json).toBe("invalid");
    vi.restoreAllMocks();
    mockFetch({ "https://site.com/": new Response("<p>", { headers: { "content-type": "text/html" } }) });
    expect((await api(ctxFor("api"), u, "GET")).json).toBe("not_json");
    vi.restoreAllMocks();
    mockFetch({ "https://site.com/": new Response(`[${"1,".repeat(40_000)}1]`, { headers: { "content-type": "application/json" } }) });
    expect((await api(ctxFor("api"), u, "GET")).json).toBe("truncated");
    vi.restoreAllMocks();
    const { calls } = mockFetch({ "https://site.com/": new Response(null, { headers: { "content-type": "application/json" } }) });
    expect((await api(ctxFor("api"), u, "HEAD")).json).toBe("not_read");
    expect(calls.find((c) => c.url === "https://site.com/")?.method).toBe("HEAD");
  });

  it("is an error on 5xx and on a failed connection", async () => {
    mockFetch({ "https://site.com/": new Response("", { status: 500 }) });
    expect((await api(ctxFor("api"), u, "GET")).responding).toBe(false);
    vi.restoreAllMocks();
    mockFetch({ "https://site.com/": () => Promise.reject(new Error("reset")) });
    expect(await api(ctxFor("api"), u, "GET")).toMatchObject({ responding: false, error: "connection_failed" });
  });
});

describe("headers", () => {
  it("grades the final response's allow-listed headers and never returns set-cookie", async () => {
    mockFetch({ "https://site.com/": new Response("ok", { headers: { "set-cookie": "s=1", "x-content-type-options": "nosniff" } }) });
    const r = await headers(ctxFor("headers"), u);
    expect(r).toMatchObject({ status: 200, grade: expect.any(String) });
    expect(JSON.stringify(r)).not.toContain("s=1");
  });

  it("reports an unreachable site", async () => {
    mockFetch({ "https://site.com/": () => Promise.reject(new Error("reset")) });
    expect(await headers(ctxFor("headers"), u)).toMatchObject({ error: "connection_failed" });
  });
});
