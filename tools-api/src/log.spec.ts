import { afterEach, describe, expect, it, vi } from "vitest";
import { hashIp } from "./log";
import { call, mockFetch } from "./test-helpers";

afterEach(() => vi.restoreAllMocks());

describe("check log", () => {
  it("never logs the full URL, query, IP or token", async () => {
    mockFetch({ "https://site.com/": () => new Response("ok") });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const ip = "203.0.113.99";
    await call(
      { tool: "uptime", input: "https://site.com/account/secret-path?token=abc123", token: "turnstile-token-xyz" },
      { headers: { "cf-connecting-ip": ip } },
    );
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"event":"check"'))!;
    expect(line).toBeDefined();
    for (const secret of ["secret-path", "abc123", "turnstile-token-xyz", ip]) expect(line).not.toContain(secret);
    expect(JSON.parse(line)).toMatchObject({ tool: "uptime", host: "site.com", outcome: "ok", turnstile: "ok" });
    expect(line).not.toContain("account");
    expect(JSON.parse(line).ipHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("hashes deterministically", async () => {
    expect(await hashIp("1.2.3.4", "k")).toBe(await hashIp("1.2.3.4", "k"));
    expect(await hashIp("1.2.3.4", undefined)).toBeUndefined();
  });
});
