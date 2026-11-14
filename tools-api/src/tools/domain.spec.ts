import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domain, resetBootstrap } from "./domain";
import { ctxFor, mockFetch } from "../test-helpers";

beforeEach(() => resetBootstrap());
afterEach(() => vi.restoreAllMocks());

const BOOT = Response.json({
  services: [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["uk"], ["http://insecure.example/", "https://rdap.nominet.uk/uk"]],
  ],
});
const future = new Date(Date.now() + 40 * 86_400_000).toISOString();
const REGISTRAR = {
  roles: ["registrar"],
  vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example Registrar"]]],
};

describe("domain tool", () => {
  it("parses expiry, registrar and status for the registrable domain", async () => {
    const { calls } = mockFetch({
      "https://data.iana.org": BOOT,
      "https://rdap.verisign.com/com/v1/domain/example.com": Response.json({
        events: [{ eventAction: "expiration", eventDate: future }],
        entities: [REGISTRAR],
        status: ["client transfer prohibited"],
      }),
    });
    const r = await domain(ctxFor("domain"), "www.example.com");
    expect(r).toMatchObject({ domain: "example.com", hasData: true, registrar: "Example Registrar", expired: false, statuses: ["client transfer prohibited"] });
    expect(r.daysLeft).toBeGreaterThanOrEqual(39);
    expect(calls.find((c) => c.url.includes("rdap.verisign"))?.headers.get("accept")).toBe("application/rdap+json");
  });

  it("asks the registry for the ICANN domain of a private-suffix host", async () => {
    mockFetch({ "https://data.iana.org": BOOT, "https://rdap.verisign.com/com/v1/domain/blogspot.com": new Response("", { status: 404 }) });
    expect(await domain(ctxFor("domain"), "me.blogspot.com")).toMatchObject({ domain: "blogspot.com", reason: "not_found" });
  });

  it("uses the public suffix list (a.b.example.co.uk -> example.co.uk) and https bases only", async () => {
    const { calls } = mockFetch({ "https://data.iana.org": BOOT, "https://rdap.nominet.uk/uk/domain/example.co.uk": new Response("", { status: 404 }) });
    const r = await domain(ctxFor("domain"), "a.b.example.co.uk");
    expect(r).toMatchObject({ domain: "example.co.uk", hasData: false, reason: "not_found" });
    expect(calls.some((c) => c.url.startsWith("http://insecure"))).toBe(false);
  });

  it("says not available for a TLD without an RDAP service, and caches the bootstrap per isolate", async () => {
    const { calls } = mockFetch({ "https://data.iana.org": BOOT });
    expect(await domain(ctxFor("domain"), "supercheck.io")).toMatchObject({ hasData: false, reason: "no_rdap_service", tld: "io" });
    await domain(ctxFor("domain"), "other.io");
    expect(calls.filter((c) => c.url.includes("iana")).length).toBe(1);
  });

  it("follows at most one https registrar link when the registry has no expiry", async () => {
    const { calls } = mockFetch({
      "https://data.iana.org": BOOT,
      "https://rdap.verisign.com/com/v1/domain/example.com": Response.json({
        entities: [REGISTRAR],
        links: [{ rel: "related", href: "https://rdap.registrar.com/domain/example.com" }],
      }),
      "https://rdap.registrar.com/domain/example.com": Response.json({
        events: [{ eventAction: "expiration", eventDate: "2001-01-01T00:00:00Z" }],
        links: [{ rel: "related", href: "https://third.com/x" }],
      }),
    });
    const r = await domain(ctxFor("domain"), "example.com");
    expect(r).toMatchObject({ hasData: true, expired: true, server: "https://rdap.registrar.com/" });
    expect(calls.some((c) => new URL(c.url).hostname === "third.com")).toBe(false);
  });

  it.each([
    ["http://rdap.registrar.com/x"],
    ["https://10.0.0.1/x"],
    ["https://optout.com/x"],
    ["https://private.com/x"],
  ])("skips an unsafe registrar link %s", async (href) => {
    const { calls } = mockFetch(
      {
        "https://data.iana.org": BOOT,
        "https://rdap.verisign.com/com/v1/domain/example.com": Response.json({ links: [{ rel: "related", href }] }),
      },
      { "private.com": ["192.168.0.1"] },
    );
    const ctx = ctxFor("domain", { ...ctxFor("domain").env, BLOCKED_HOSTS: "optout.com" });
    const r = await domain(ctx, "example.com");
    expect(r).toMatchObject({ hasData: false, reason: "no_expiry_published" });
    expect(calls.some((c) => c.url === href)).toBe(false);
  });

  it("reports rdap_error on a bad body and throws when the bootstrap is down", async () => {
    mockFetch({ "https://data.iana.org": BOOT, "https://rdap.verisign.com/com/v1/domain/example.com": new Response("{nope") });
    expect(await domain(ctxFor("domain"), "example.com")).toMatchObject({ reason: "rdap_error" });
    vi.restoreAllMocks();
    resetBootstrap();
    mockFetch({ "https://data.iana.org": new Response("", { status: 500 }) });
    await expect(domain(ctxFor("domain"), "example.com")).rejects.toThrow("bootstrap_unavailable");
  });
});
