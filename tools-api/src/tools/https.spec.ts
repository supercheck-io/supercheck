import { afterEach, describe, expect, it, vi } from "vitest";
import { https } from "./https";
import { ctxFor, mockFetch, redirect } from "../test-helpers";

afterEach(() => vi.restoreAllMocks());

const HSTS = { "strict-transport-security": "max-age=63072000; includeSubDomains; preload" };
const run = (host = "site.com") => https(ctxFor("https"), new URL(`https://${host}/`));

describe("https tool", () => {
  it("passes with a valid cert, http->https redirect, HSTS and preload status", async () => {
    mockFetch({
      "https://site.com/": new Response("ok", { headers: HSTS }),
      "http://site.com/": redirect("https://www.site.com/"),
      "https://www.site.com/": new Response("ok"),
      "https://hstspreload.org": Response.json({ status: "preloaded" }),
    });
    const r = await run();
    expect(r).toMatchObject({ ok: true, problems: 0, certificateValid: true, redirectsToHttps: true, preload: "preloaded" });
    expect(r.hsts).toEqual({ maxAge: 63072000, maxAgeDays: 730, includeSubDomains: true, preload: true });
  });

  it("maps a certificate failure to 'Certificate valid: no' with the error class", async () => {
    mockFetch({
      "https://site.com/": () => Promise.reject(new TypeError("TLS handshake: certificate has expired")),
      "http://site.com/": new Response("plain"),
      "https://hstspreload.org": Response.json({ status: "unknown" }),
    });
    const r = await run();
    expect(r).toMatchObject({ certificateValid: false, certificateError: "tls_error", redirectsToHttps: false, hsts: null, problems: 3 });
  });

  it("only counts an http redirect to https on the same registrable domain", async () => {
    mockFetch({
      "https://site.com/": new Response("ok", { headers: HSTS }),
      "http://site.com/": redirect("https://other.com/"),
      "https://other.com/": new Response("ok"),
      "https://hstspreload.org": Response.json({ status: "pending" }),
    });
    expect(await run()).toMatchObject({ redirectsToHttps: false, preload: "pending" });
  });

  it("treats an https redirect loop as a valid certificate and a preload API error as error", async () => {
    mockFetch({
      "https://site.com/": redirect("https://site.com/"),
      "http://site.com/": redirect("https://site.com/"),
      "https://hstspreload.org": () => Promise.reject(new Error("down")),
    });
    expect(await run()).toMatchObject({ certificateValid: true, preload: "error" });
  });

  it("reads unknown preload states as unknown", async () => {
    mockFetch({ "https://site.com/": new Response("ok"), "http://site.com/": new Response("ok"), "https://hstspreload.org": Response.json({ status: "weird" }) });
    expect((await run()).preload).toBe("unknown");
  });
});
