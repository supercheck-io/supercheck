import { describe, expect, it } from "vitest";
import { grade, letter, parseCsp, parseHsts } from "./grade";

const STRONG = {
  "content-security-policy": "default-src 'none'; script-src 'self'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const row = (h: Record<string, string>, id: string, https = true) => grade(h, https).rows.find((r) => r.id === id);

describe("grade boundaries", () => {
  it.each([
    [120, "A+"],
    [100, "A+"],
    [99, "A"],
    [90, "A"],
    [89, "A-"],
    [85, "A-"],
    [84, "B+"],
    [80, "B+"],
    [79, "B"],
    [70, "B"],
    [69, "B-"],
    [65, "B-"],
    [64, "C+"],
    [60, "C+"],
    [59, "C"],
    [50, "C"],
    [49, "C-"],
    [45, "C-"],
    [44, "D+"],
    [40, "D+"],
    [39, "D"],
    [30, "D"],
    [29, "D-"],
    [25, "D-"],
    [24, "F"],
    [0, "F"],
  ])("%d -> %s", (score, expected) => expect(letter(score)).toBe(expected));
});

describe("grade rules", () => {
  it("a strong set scores A+ with bonuses", () => {
    const g = grade(STRONG, true);
    expect(g.score).toBe(120);
    expect(g.grade).toBe("A+");
  });

  it("no headers at all floors at a weighted F, never below 0", () => {
    const g = grade({}, true);
    // -25 csp, -20 hsts, -5 xcto, -20 framing
    expect(g.score).toBe(30);
    expect(g.grade).toBe("D");
    expect(grade({}, false).score).toBe(30);
  });

  it("CSP missing: -25; report-only counts as missing", () => {
    expect(row({ "content-security-policy-report-only": "default-src 'self'" }, "csp")?.modifier).toBe(-25);
  });

  it("CSP unsafe-inline without nonce: -20; with a nonce: no penalty", () => {
    expect(row({ "content-security-policy": "script-src 'self' 'unsafe-inline'" }, "csp")?.modifier).toBe(-20);
    expect(row({ "content-security-policy": "script-src 'unsafe-inline' 'nonce-abc'" }, "csp")?.modifier).toBe(0);
  });

  it.each(["data:", "*", "http:"])("CSP script source %s: -20", (src) => {
    expect(row({ "content-security-policy": `default-src ${src}` }, "csp")?.modifier).toBe(-20);
  });

  it("CSP without script-src or default-src is treated as unsafe", () => {
    expect(row({ "content-security-policy": "img-src 'self'" }, "csp")?.modifier).toBe(-20);
  });

  it("script-src-elem and script-src-attr can make a strict script-src unsafe", () => {
    expect(row({ "content-security-policy": "script-src 'self'; script-src-elem 'unsafe-inline'; object-src 'none'" }, "csp")?.modifier).toBe(-20);
    expect(row({ "content-security-policy": "default-src 'self'; script-src-attr 'unsafe-inline'" }, "csp")?.modifier).toBe(-20);
    expect(row({ "content-security-policy": "script-src 'unsafe-inline' 'nonce-a'; script-src-elem 'self'; object-src 'none'" }, "csp")?.modifier).toBe(5);
  });

  it("CSP unsafe-eval: -10", () => {
    expect(row({ "content-security-policy": "script-src 'self' 'unsafe-eval'" }, "csp-eval")?.modifier).toBe(-10);
  });

  it("CSP object-src 'none' bonus: +5", () => {
    expect(row({ "content-security-policy": "script-src 'self'; object-src 'none'" }, "csp")?.modifier).toBe(5);
    expect(row({ "content-security-policy": "script-src 'self'" }, "csp")?.modifier).toBe(0);
  });

  it("multiple CSP headers combine to the strictest", () => {
    const h = { "content-security-policy": "script-src 'unsafe-inline', script-src 'self'" };
    expect(row(h, "csp")?.modifier).toBe(0);
  });

  it("HSTS missing -20, short -10, full +5, http final URL -20", () => {
    expect(row({}, "hsts")?.modifier).toBe(-20);
    expect(row({ "strict-transport-security": "max-age=600" }, "hsts")?.modifier).toBe(-10);
    expect(row({ "strict-transport-security": "max-age=31536000" }, "hsts")?.modifier).toBe(0);
    expect(row({ "strict-transport-security": "max-age=31536000; includeSubDomains; preload" }, "hsts")?.modifier).toBe(5);
    expect(row(STRONG, "hsts", false)?.modifier).toBe(-20);
    expect(row({ "strict-transport-security": "garbage" }, "hsts")?.modifier).toBe(-20);
  });

  it("X-Content-Type-Options not nosniff: -5", () => {
    expect(row({ "x-content-type-options": "sniff" }, "x-content-type-options")?.modifier).toBe(-5);
    expect(row({ "x-content-type-options": " NoSniff " }, "x-content-type-options")?.modifier).toBe(0);
  });

  it("framing: -20 missing, 0 XFO, +5 frame-ancestors", () => {
    expect(row({}, "framing")?.modifier).toBe(-20);
    expect(row({ "x-frame-options": "SAMEORIGIN" }, "framing")?.modifier).toBe(0);
    expect(row({ "x-frame-options": "ALLOW-FROM x" }, "framing")?.modifier).toBe(-20);
    expect(row({ "content-security-policy": "frame-ancestors 'self'" }, "framing")?.modifier).toBe(5);
  });

  it("referrer policy: +5 private, -5 leaky or invalid, info when unset or downgrade", () => {
    expect(row({ "referrer-policy": "no-referrer" }, "referrer-policy")?.modifier).toBe(5);
    expect(row({ "referrer-policy": "unsafe-url" }, "referrer-policy")?.modifier).toBe(-5);
    expect(row({ "referrer-policy": "bogus" }, "referrer-policy")?.modifier).toBe(-5);
    expect(row({ "referrer-policy": "unsafe-url, strict-origin" }, "referrer-policy")?.modifier).toBe(5);
    expect(row({ "referrer-policy": "no-referrer-when-downgrade" }, "referrer-policy")?.status).toBe("info");
    expect(row({}, "referrer-policy")?.status).toBe("info");
  });

  it("permissions policy and COOP are shown, not scored", () => {
    const g = grade({ ...STRONG, "permissions-policy": "camera=()", "cross-origin-opener-policy": "same-origin" }, true);
    expect(g.rows.find((r) => r.id === "permissions-policy")).toMatchObject({ modifier: 0, value: "camera=()" });
    expect(g.score).toBe(120);
  });

  it("bonuses only count when the score before bonuses is at least 90", () => {
    // 100 - 20 (unsafe-inline) = 80; +5 frame-ancestors +5 hsts +5 referrer ignored
    const h = { ...STRONG, "content-security-policy": "script-src 'unsafe-inline'; frame-ancestors 'none'" };
    expect(grade(h, true).score).toBe(80);
    // exactly 90: bonuses apply
    const ninety = { ...STRONG, "x-content-type-options": "", "content-security-policy": "script-src 'self' 'unsafe-eval'; frame-ancestors 'none'" };
    // 100 -10 eval -5 xcto = 85 -> no bonus
    expect(grade(ninety, true).score).toBe(85);
    const atNinety = { ...STRONG, "content-security-policy": "script-src 'self' 'unsafe-eval'; frame-ancestors 'none'" };
    // 100 -10 = 90 -> + frame 5 + hsts 5 + referrer 5
    expect(grade(atNinety, true).score).toBe(105);
  });
});

describe("parsers", () => {
  it("parseCsp splits joined headers and ignores empty parts", () => {
    expect(parseCsp("a b; c d, e f")).toHaveLength(2);
    expect(parseCsp(undefined)).toEqual([]);
  });

  it("parseHsts reads the first of joined headers", () => {
    expect(parseHsts('max-age="100", max-age=5')).toEqual({ maxAge: 100, includeSubDomains: false, preload: false });
    expect(parseHsts("includeSubDomains")).toBeNull();
    expect(parseHsts("max-age=-1")).toBeNull();
  });
});
