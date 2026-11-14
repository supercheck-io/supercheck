import test from "node:test";
import assert from "node:assert/strict";
import { invalidMessage, loadableImage, monitorTarget, monitorThisHref, shareHref, toState } from "../src/lib/tools-funnel.ts";
// The app's own allow-list for `next`, so a change on either side fails here, not in production.
import { sanitizeNextPath } from "../../app/src/lib/auth/safe-next-path.ts";

/** What AuthGuard sends for a signed-out visitor, then what sign-in reads back and resumes. */
function resumedNext(href: string): string | null {
  const url = new URL(href);
  const signIn = new URL(`https://app.test/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);
  return sanitizeNextPath(signIn.searchParams.get("next"));
}

test("toState maps every Worker response, and anything else is busy", () => {
  assert.deepEqual(toState(200, { ok: true, result: { up: true }, checkedAt: "t", colo: "FRA", cached: true }), {
    kind: "result",
    result: { up: true },
    checkedAt: "t",
    colo: "FRA",
    cached: true,
  });
  assert.deepEqual(toState(400, { error: "invalid_input", reason: "port" }), { kind: "invalid", reason: "port" });
  assert.deepEqual(toState(403, { error: "captcha_failed" }), { kind: "captcha" });
  assert.deepEqual(toState(429, { error: "rate_limited", retryAfter: 40 }), { kind: "rate_limited", retryAfter: 40 });
  assert.deepEqual(toState(429, { error: "rate_limited" }), { kind: "rate_limited", retryAfter: 60 });
  assert.deepEqual(toState(503, { error: "disabled" }), { kind: "disabled" });
  // Error 1027 (daily cap), HTML pages, origin rejections and network failures
  for (const [status, body] of [[1027, null], [500, "<html>"], [403, { error: "origin_not_allowed" }], [200, { ok: false }], [0, null]] as const) {
    assert.deepEqual(toState(status, body), { kind: "busy" });
  }
});

test("invalidMessage has copy for known reasons and a fallback", () => {
  assert.match(invalidMessage("port"), /80 and 443/);
  assert.match(invalidMessage("whatever"), /public domain/);
});

test("monitorThisHref links the app's form in the shape its monitor pattern accepts", () => {
  const href = monitorThisHref("uptime", "https://ex.com/a b?api_key=SECRET#frag");
  assert.ok(!href.includes("SECRET"));
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, "https://app.supercheck.io/monitors/create");
  const next = url.pathname + url.search; // what the app's AuthGuard forwards as next
  assert.equal(resumedNext(href), next);
  const inner = new URLSearchParams(next.split("?")[1]);
  assert.equal(inner.get("url"), "https://ex.com/a%20b");
  assert.equal(inner.get("name"), "ex.com");
  assert.equal(inner.get("type"), "website");
});

test("URLs with ( ) * ! ' still match the app's monitor pattern", () => {
  const u = new URL(monitorThisHref("uptime", "https://en.wikipedia.org/wiki/Foo_(bar)*!'"));
  assert.equal(resumedNext(u.toString()), u.pathname + u.search);
});

test("every Monitor-this link the pages build survives sign-in unchanged", () => {
  for (const href of [
    monitorThisHref("api", "api.ex.com/health?probe=1", "HEAD"),
    monitorThisHref("https", "ex.com"),
    monitorThisHref("uptime", "https://ex.com/a+b%20c/100%"),
    monitorThisHref("uptime", `https://ex.com/${"a".repeat(2000)}`), // falls back to the type-only form
  ]) {
    const u = new URL(href);
    assert.equal(resumedNext(href), u.pathname + u.search, href);
  }
});

test("monitorTarget picks the monitor type and target per tool", () => {
  assert.deepEqual(monitorTarget("api", "api.ex.com/health", "HEAD"), { type: "http_request", url: "https://api.ex.com/health", name: "api.ex.com", method: "HEAD" });
  assert.deepEqual(monitorTarget("api", "api.ex.com", "GET"), { type: "http_request", url: "https://api.ex.com/", name: "api.ex.com" });
  assert.equal(monitorTarget("dns", "ex.com")?.url, "https://ex.com/");
  assert.equal(monitorTarget("domain", "https://www.ex.com/path")?.url, "https://www.ex.com/");
  assert.equal(monitorTarget("uptime", ""), null);
  assert.equal(monitorTarget("uptime", "javascript:alert(1)"), null);
  assert.equal(monitorTarget("uptime", "https://u:p@ex.com"), null);
  assert.equal(monitorThisHref("uptime", ""), "https://app.supercheck.io/monitors/create");
  // Too long for the continuation: the form opens without the pre-fill instead of losing it silently later.
  assert.equal(monitorThisHref("uptime", `https://ex.com/${"a".repeat(2000)}`), "https://app.supercheck.io/monitors/create?type=website");
  // Measured after encoding: 140 non-ASCII characters are short raw but long encoded.
  assert.equal(monitorThisHref("uptime", `https://ex.com/${"é".repeat(140)}`), "https://app.supercheck.io/monitors/create?type=website");
  assert.equal(monitorTarget("https", "http://ex.com/")?.url, "https://ex.com/");
});

test("shareHref only for inputs without a query or userinfo", () => {
  assert.equal(shareHref("dns-lookup", "dns", "ex.com"), "/tools/dns-lookup?domain=ex.com");
  assert.equal(shareHref("https-checker", "https", "https://ex.com/"), "/tools/https-checker?url=https%3A%2F%2Fex.com%2F");
  assert.equal(shareHref("x", "uptime", "https://ex.com/?token=1"), null);
  assert.equal(shareHref("x", "uptime", "https://u@ex.com/"), null);
  assert.equal(shareHref("x", "uptime", ""), null);
});

test("loadableImage allows https only", () => {
  assert.equal(loadableImage("https://ex.com/i.png"), "https://ex.com/i.png");
  assert.equal(loadableImage("http://ex.com/i.png"), null);
  assert.equal(loadableImage("javascript:alert(1)"), null);
  assert.equal(loadableImage(42), null);
});
