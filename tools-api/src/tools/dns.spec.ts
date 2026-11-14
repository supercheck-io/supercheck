import { afterEach, describe, expect, it, vi } from "vitest";
import { dns } from "./dns";
import { ctxFor, mockFetch } from "../test-helpers";

afterEach(() => vi.restoreAllMocks());

const answer = (type: number, data: string, extra: object = {}) => Response.json({ Status: 0, ...extra, Answer: [{ name: "x.com.", type, TTL: 300, data }] });

describe("dns tool", () => {
  it("parses all seven types and the DNSSEC AD flag", async () => {
    const { calls } = mockFetch({
      "doh:x.com:A": answer(1, "93.184.215.14", { AD: true }),
      "doh:x.com:AAAA": answer(28, "2606:4700::1"),
      "doh:x.com:CNAME": Response.json({ Status: 0 }),
      "doh:x.com:MX": answer(15, "10 mx.x.com."),
      "doh:x.com:TXT": answer(16, '"v=spf1 -all"'),
      "doh:x.com:NS": answer(2, "ns1.x.com."),
      "doh:x.com:CAA": answer(257, '0 issue "letsencrypt.org"'),
    });
    const r = await dns(ctxFor("dns"), "x.com");
    expect(r).toMatchObject({ resolves: true, count: 6, dnssec: true, failedQueries: 0 });
    expect(r.records.MX?.[0]).toEqual({ name: "x.com.", ttl: 300, data: "10 mx.x.com." });
    expect(r.records.CNAME).toBeUndefined();
    expect(calls.every((c) => c.headers.get("accept") === "application/dns-json")).toBe(true);
  });

  it("returns private addresses a public zone publishes", async () => {
    mockFetch({ "doh:x.com:A": answer(1, "10.0.0.1") });
    expect((await dns(ctxFor("dns"), "x.com")).records.A?.[0].data).toBe("10.0.0.1");
  });

  it("reports NXDOMAIN as not resolving", async () => {
    mockFetch({ "doh:nx.com": Response.json({ Status: 3 }) });
    expect(await dns(ctxFor("dns"), "nx.com")).toMatchObject({ resolves: false, count: 0, failedQueries: 0 });
  });

  it("counts SERVFAIL, HTTP and network errors as failed queries", async () => {
    mockFetch({
      "doh:f.com:A": Response.json({ Status: 2 }),
      "doh:f.com:AAAA": new Response("", { status: 502 }),
      "doh:f.com:MX": () => Promise.reject(new Error("x")),
    });
    const ctx = ctxFor("dns");
    expect((await dns(ctx, "f.com")).failedQueries).toBe(3);
    expect(ctx.degraded).toBe(true);
  });

  it("caps answers at 50 and data at 512 characters", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: "x.com.", type: 16, TTL: 1, data: `"${i}${"a".repeat(600)}"` }));
    mockFetch({ "doh:x.com:TXT": Response.json({ Status: 0, Answer: many }) });
    const txt = (await dns(ctxFor("dns"), "x.com")).records.TXT!;
    expect(txt).toHaveLength(50);
    expect(txt[0].data).toHaveLength(512);
  });
});
