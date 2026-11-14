import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckStop } from "./context";
import { ipBucket, isReservedIp } from "./ip-ranges";
import { ctxFor, mockFetch } from "./test-helpers";

afterEach(() => vi.restoreAllMocks());

describe("isReservedIp", () => {
  it.each([
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "172.16.5.4",
    "192.168.1.1",
    "224.0.0.1",
    "240.0.0.1",
    "0.0.0.0",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "::",
    "fe80::1",
    "fd12::1",
    "ff02::1",
    "64:ff9b::a00:1",
    "2001:db8::1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "not-an-ip",
  ])("reserves %s", (ip) => expect(isReservedIp(ip)).toBe(true));

  it.each(["93.184.215.14", "1.1.1.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows public %s", (ip) =>
    expect(isReservedIp(ip)).toBe(false),
  );
});

describe("ipBucket", () => {
  it("buckets IPv6 by /64 and keeps IPv4", () => {
    expect(ipBucket("2001:db8:1:2:aaaa::1")).toBe(ipBucket("2001:db8:1:2:bbbb::9"));
    expect(ipBucket("2001:db8:1:3::1")).not.toBe(ipBucket("2001:db8:1:2::1"));
    expect(ipBucket("203.0.113.9")).toBe("203.0.113.9");
    expect(ipBucket("nope")).toBeNull();
  });
});

describe("DoH pre-check", () => {
  const vet = (host: string) => ctxFor("uptime").vetHost(host, "blocked");

  it.each([["10.0.0.5"], ["127.0.0.1"], ["100.64.1.1"], ["fd00::1"], ["::ffff:192.168.0.1"], ["64:ff9b::7f00:1"]])(
    "blocks a host resolving to %s",
    async (ip) => {
      mockFetch({}, { "evil.com": [ip] });
      await expect(vet("evil.com")).rejects.toMatchObject({ kind: "blocked", reason: "private_address" });
    },
  );

  it("blocks when any one of several answers is private", async () => {
    mockFetch({}, { "mixed.com": ["93.184.215.14", "10.0.0.1"] });
    await expect(vet("mixed.com")).rejects.toMatchObject({ reason: "private_address" });
  });

  it("fails closed on DoH HTTP errors, SERVFAIL, thrown errors and no answers", async () => {
    mockFetch({ "doh:a.com": new Response("x", { status: 500 }) });
    await expect(vet("a.com")).rejects.toMatchObject({ reason: "dns_error" });
    vi.restoreAllMocks();
    mockFetch({ "doh:b.com": Response.json({ Status: 2 }) });
    await expect(vet("b.com")).rejects.toMatchObject({ reason: "dns_error" });
    vi.restoreAllMocks();
    mockFetch({ "doh:c.com": () => Promise.reject(new Error("timed out")) });
    await expect(vet("c.com")).rejects.toMatchObject({ reason: "dns_error" });
    vi.restoreAllMocks();
    mockFetch({}, { "d.com": [] });
    await expect(vet("d.com")).rejects.toMatchObject({ reason: "no_address" });
    vi.restoreAllMocks();
    mockFetch({ "doh:e.com": Response.json({ Status: 3 }) });
    await expect(vet("e.com")).rejects.toMatchObject({ reason: "no_address" });
  });

  it("treats a CNAME-only answer as no address", async () => {
    mockFetch({ "doh:alias.com": Response.json({ Status: 0, Answer: [{ type: 5, data: "target.com." }] }) });
    await expect(vet("alias.com")).rejects.toMatchObject({ reason: "no_address" });
  });

  it("memoizes per check and allows public hosts", async () => {
    const { calls } = mockFetch({}, { "ok.com": ["93.184.215.14", "2606:4700::1"] });
    const ctx = ctxFor("uptime");
    await ctx.vetHost("ok.com", "blocked");
    await ctx.vetHost("ok.com", "blocked");
    expect(calls.filter((c) => c.url.includes("dns-query"))).toHaveLength(2);
  });

  it("caps distinct hosts per tool and keeps agents on one site", async () => {
    mockFetch();
    const ctx = ctxFor("agents");
    for (const h of ["a.com", "b.com", "c.com"]) await ctx.vetHost(h, "blocked");
    await expect(ctx.vetHost("d.com", "blocked")).rejects.toMatchObject({ kind: "limited", reason: "too_many_hosts" });
    const same = ctxFor("agents", undefined, "site.com");
    await same.vetHost("www.site.com", "blocked");
    await expect(same.vetHost("other.com", "blocked_redirect")).rejects.toBeInstanceOf(CheckStop);
  });

  it("charges the per-target limit once per registrable domain", async () => {
    mockFetch();
    const keys: string[] = [];
    let n = 0;
    const limiter = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: ++n <= 1 }) } as unknown as RateLimit;
    const ctx = ctxFor("uptime", { IP_MINUTE: limiter, IP_BURST: limiter, TARGET_MINUTE: limiter });
    await ctx.vetHost("a1.victim.com", "blocked");
    await ctx.vetHost("a2.victim.com", "blocked");
    expect(keys).toEqual(["victim.com"]);
    await expect(ctx.vetHost("other.com", "blocked_redirect")).rejects.toMatchObject({ kind: "limited", reason: "target_rate_limited" });
  });
});
