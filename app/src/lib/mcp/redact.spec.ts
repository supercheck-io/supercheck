/** @jest-environment node */
import { safeTarget, safeText } from "./redact";

describe("safeTarget", () => {
  it("keeps only scheme and host of http(s) URLs", () => {
    expect(safeTarget("https://u:pw@example.com/hooks/SECRET?token=abc")).toBe("https://example.com");
  });
  it("does not leak credentials from scheme-less targets", () => {
    expect(safeTarget("user:pw@host.example:80")).toBe("host.example:80");
  });
});

describe("safeText", () => {
  it("redacts URL credentials, basic auth, cookies and stripe keys", () => {
    const out = safeText("postgres://a:b@db/x Authorization: Basic abc123 Cookie: s=1 sk_live_abcdefgh12345")!;
    expect(out).not.toMatch(/a:b@|abc123|s=1|sk_live_/);
  });
  it("truncates long text", () => {
    expect(safeText("x".repeat(5000))!.endsWith("[truncated]")).toBe(true);
  });
});
