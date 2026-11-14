import { afterEach, describe, expect, it, vi } from "vitest";
import { hostnameAllowed, verifyTurnstile } from "./turnstile";
import { call, mockFetch, testEnv } from "./test-helpers";

afterEach(() => vi.restoreAllMocks());

const body = { tool: "uptime", input: "https://site.com/", token: "tok" };
const strict = { TURNSTILE_SECRET: "s", TURNSTILE_HOSTNAMES: "supercheck.io,supercheck.pages.dev" };

describe("hostname suffix match", () => {
  it("accepts the apex, www and preview hosts but not look-alikes", () => {
    const allowed = ["supercheck.io", "supercheck.pages.dev"];
    expect(hostnameAllowed("supercheck.io", allowed)).toBe(true);
    expect(hostnameAllowed("www.supercheck.io", allowed)).toBe(true);
    expect(hostnameAllowed("abc.supercheck.pages.dev", allowed)).toBe(true);
    expect(hostnameAllowed("evilsupercheck.io", allowed)).toBe(false);
    expect(hostnameAllowed("supercheck.io.evil.com", allowed)).toBe(false);
  });
});

describe("Turnstile gate", () => {
  it.each([
    ["failure", { success: false }],
    ["wrong action", { success: true, action: "dns", hostname: "supercheck.io" }],
    ["wrong hostname", { success: true, action: "uptime", hostname: "evilsupercheck.io" }],
  ])("403s on %s without touching the target or the host bucket", async (_label, verdict) => {
    const { targets } = mockFetch({ turnstile: Response.json(verdict) });
    const hostLimit = vi.fn(async () => ({ success: true }));
    const res = await call(body, { env: { ...strict, TARGET_MINUTE: { limit: hostLimit } as unknown as RateLimit } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "captcha_failed" });
    expect(targets()).toHaveLength(0);
    expect(hostLimit).not.toHaveBeenCalled();
  });

  it("calls siteverify with the secret, token and remoteip on success", async () => {
    const { calls } = mockFetch({
      turnstile: Response.json({ success: true, action: "uptime", hostname: "www.supercheck.io" }),
      "https://site.com/": new Response("ok"),
    });
    const res = await call(body, { env: strict, headers: { "cf-connecting-ip": "203.0.113.77" } });
    expect(res.status).toBe(200);
    const verify = calls.find((c) => c.url.includes("siteverify"))!;
    const form = await verify.formData();
    expect(form.get("remoteip")).toBe("203.0.113.77");
    expect(form.get("response")).toBe("tok");
    expect(form.get("secret")).toBe("s");
  });

  it("fails closed when siteverify is unreachable", async () => {
    mockFetch({ turnstile: () => Promise.reject(new Error("down")) });
    expect(await verifyTurnstile(testEnv(strict), "t", "uptime", "1.1.1.1")).toBe("fail");
  });
});
