import test from "node:test";
import assert from "node:assert/strict";
import { invalidMessage, loadableImage, monitorTarget, monitorThisHref, shareHref, toState } from "../src/lib/tools-funnel.ts";

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

test("monitorThisHref builds a double-encoded next that the app's monitor pattern accepts", () => {
  const href = monitorThisHref("uptime", "https://ex.com/a b?api_key=SECRET#frag");
  assert.ok(!href.includes("SECRET"));
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, "https://app.supercheck.io/sign-in");
  const next = url.searchParams.get("next")!; // decoded once, as the app reads it
  assert.match(next, /^\/monitors\/create\?type=(website|http_request)&url=[A-Za-z0-9%._~-]{1,6200}(&name=[A-Za-z0-9%._~-]{1,300})?(&method=(GET|HEAD))?$/);
  const inner = new URLSearchParams(next.split("?")[1]);
  assert.equal(inner.get("url"), "https://ex.com/a%20b");
  assert.equal(inner.get("name"), "ex.com");
  assert.equal(inner.get("type"), "website");
});

test("monitorTarget picks the monitor type and target per tool", () => {
  assert.deepEqual(monitorTarget("api", "api.ex.com/health", "HEAD"), { type: "http_request", url: "https://api.ex.com/health", name: "api.ex.com", method: "HEAD" });
  assert.deepEqual(monitorTarget("api", "api.ex.com", "GET"), { type: "http_request", url: "https://api.ex.com/", name: "api.ex.com" });
  assert.equal(monitorTarget("dns", "ex.com")?.url, "https://ex.com/");
  assert.equal(monitorTarget("domain", "https://www.ex.com/path")?.url, "https://www.ex.com/");
  assert.equal(monitorTarget("uptime", ""), null);
  assert.equal(monitorTarget("uptime", "javascript:alert(1)"), null);
  assert.equal(monitorTarget("uptime", "https://u:p@ex.com"), null);
  assert.equal(monitorThisHref("uptime", ""), "https://app.supercheck.io/sign-in");
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
