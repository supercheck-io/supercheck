import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchErrorClass, SUBREQUEST_BUDGET } from "./context";
import { agents } from "./tools/agents";
import { ctxFor, mockFetch } from "./test-helpers";

afterEach(() => vi.restoreAllMocks());

describe("subrequest budget", () => {
  it("stops at 40 with limited", async () => {
    mockFetch({ "https://x.com/": new Response("ok") });
    const ctx = ctxFor("uptime");
    for (let i = 0; i < SUBREQUEST_BUDGET; i++) await ctx.fetch("https://x.com/");
    expect(ctx.subrequests).toBe(40);
    await expect(ctx.fetch("https://x.com/")).rejects.toMatchObject({ kind: "limited", reason: "subrequest_budget" });
  });

  it("never has more than 3 agents requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return new Response("nope", { status: 404 });
    };
    mockFetch({ "https://site.com/": slow });
    await agents(ctxFor("agents", undefined, "site.com"), new URL("https://site.com/"));
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("fetchErrorClass", () => {
  it("classifies errors", () => {
    expect(fetchErrorClass(new DOMException("x", "TimeoutError"))).toBe("timeout");
    expect(fetchErrorClass(new Error("TLS handshake failed"))).toBe("tls_error");
    expect(fetchErrorClass(new Error("DNS lookup failed"))).toBe("dns_error");
    expect(fetchErrorClass(new Error("reset"))).toBe("connection_failed");
    expect(fetchErrorClass("weird")).toBe("connection_failed");
  });
});
