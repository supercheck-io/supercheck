import { expect, test, type Page, type Route } from "@playwright/test";

// Needs a build with NEXT_PUBLIC_CHECKS_API_URL=https://tools-api.test and a Turnstile site key.
const API = "https://tools-api.test/v1/check";
test.skip(process.env.E2E_TOOLS !== "configured", "needs the configured tools build");

const FAKE_TURNSTILE = `window.turnstile = {
  render(el, o) { window.__ts = o; return "w1"; },
  execute() { const o = window.__ts; setTimeout(() => window.__tsFail ? o["error-callback"]() : o.callback("tok"), 0); },
  reset() { window.__tsResets = (window.__tsResets || 0) + 1; },
  remove() {},
};`;

async function setup(page: Page, reply: (body: Record<string, unknown>) => { status: number; json?: unknown; text?: string }) {
  const requests: Record<string, unknown>[] = [];
  await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_TURNSTILE }));
  await page.route(API, async (route: Route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
    requests.push({ ...body, contentType: req.headers()["content-type"], method: req.method() });
    const r = reply(body);
    await route.fulfill({
      status: r.status,
      contentType: r.json !== undefined ? "application/json" : "text/html",
      headers: { "access-control-allow-origin": "*" },
      body: r.json !== undefined ? JSON.stringify(r.json) : (r.text ?? ""),
    });
  });
  return requests;
}

const ok = (tool: string, result: unknown) => ({ status: 200, json: { ok: true, tool, result, checkedAt: "2026-11-14T14:02:00Z", colo: "FRA", cached: false } });

const CASES: { slug: string; tool: string; input: string; result: unknown; verdict: RegExp; limit: RegExp }[] = [
  { slug: "website-uptime-checker", tool: "uptime", input: "example.com", result: { up: true, status: 200, timeMs: 120, finalUrl: "https://example.com/", hops: [], server: "nginx" }, verdict: /Up · 200/, limit: /can't tell you whether the site is down for everyone/ },
  { slug: "api-endpoint-checker", tool: "api", input: "https://api.example.com/health", result: { responding: true, status: 200, timeMs: 90, contentType: "application/json", json: "valid", cors: "*", cacheControl: null, hops: [] }, verdict: /Responding · 200/, limit: /Only GET and HEAD/ },
  { slug: "https-checker", tool: "https", input: "example.com", result: { ok: false, problems: 1, certificateValid: true, certificateError: null, redirectsToHttps: true, httpHops: [], hsts: null, hstsHeader: null, preload: "unknown" }, verdict: /1 problem found/, limit: /Expiry date and issuer are not visible/ },
  { slug: "security-headers-checker", tool: "headers", input: "example.com", result: { status: 200, finalUrl: "https://example.com/", hops: [], headers: {}, grade: "B", score: 75, rows: [{ id: "csp", status: "fail", modifier: -25, value: null, note: "Content-Security-Policy is missing" }] }, verdict: /Grade B · score 75/, limit: /Headers only/ },
  { slug: "agent-readiness-checker", tool: "agents", input: "example.com", result: { passed: 3, total: 4, checks: [{ id: "https", status: "pass", detail: "https" }], training: [], robotsTruncated: false, discovery: { agentCard: { status: "info", name: null, missing: [] }, mcp: { status: "info", path: null } } }, verdict: /3 of 4 checks pass/, limit: /first 128 KB of robots.txt/ },
  { slug: "dns-lookup", tool: "dns", input: "example.com", result: { domain: "example.com", resolves: true, count: 1, records: { A: [{ name: "example.com.", ttl: 300, data: "93.184.215.14" }] }, dnssec: true, failedQueries: 0 }, verdict: /1 record found/, limit: /Cloudflare's resolver/ },
  { slug: "social-preview-checker", tool: "social", input: "https://example.com/post", result: { status: 200, finalUrl: "https://example.com/post", tags: { "og:title": "Hello" }, title: "Hello", description: null, truncated: false, missing: ["og:image"], image: null }, verdict: /1 tags missing/, limit: /up to 64 KB/ },
  { slug: "domain-expiry-checker", tool: "domain", input: "supercheck.io", result: { domain: "supercheck.io", hasData: false, reason: "no_rdap_service", tld: "io" }, verdict: /Not available for \.io/, limit: /don't publish expiry dates through RDAP/ },
];

for (const c of CASES) {
  test.describe(c.slug, () => {
    test("valid input renders the result and a Monitor this hand-off", async ({ page }) => {
      const requests = await setup(page, () => ok(c.tool, c.result));
      await page.goto(`/tools/${c.slug}`);
      await expect(page.getByTestId("tool-limits")).toContainText(c.limit);
      await page.getByTestId("tool-form").getByRole("textbox").fill(c.input);
      await page.getByTestId("tool-form").getByRole("button").click();
      await expect(page.getByTestId("tool-verdict")).toContainText(c.verdict);
      await expect(page.getByTestId("tool-checked-from")).toContainText("Checked from Cloudflare FRA");
      expect(requests[0]).toMatchObject({ tool: c.tool, input: c.input, token: "tok", method: "POST" });
      expect(String(requests[0].contentType)).toMatch(/^text\/plain/);
      const href = await page.getByTestId("tool-monitor-this").getAttribute("href");
      const next = new URL(href!).searchParams.get("next")!;
      expect(next).toMatch(/^\/monitors\/create\?type=(website|http_request)&url=/);
    });

    test("invalid input, rate limit and busy states", async ({ page }) => {
      let n = 0;
      await setup(page, () => {
        n += 1;
        if (n === 1) return { status: 400, json: { error: "invalid_input", reason: "port" } };
        if (n === 2) return { status: 429, json: { error: "rate_limited", retryAfter: 40 } };
        return { status: 500, text: "<html>error code: 1027</html>" };
      });
      await page.goto(`/tools/${c.slug}`);
      const form = page.getByTestId("tool-form");
      await form.getByRole("textbox").fill(c.input);
      await form.getByRole("button").click();
      await expect(page.getByTestId("tool-invalid")).toContainText("80 and 443");
      await form.getByRole("button").click();
      await expect(page.getByTestId("tool-status")).toContainText("Try again in 40 seconds");
      await form.getByRole("button").click();
      await expect(page.getByTestId("tool-status")).toContainText("busy right now");
    });
  });
}

test("captcha failure resets and never calls the API; disabled shows paused", async ({ page }) => {
  const requests = await setup(page, () => ({ status: 503, json: { error: "disabled" } }));
  await page.goto("/tools/dns-lookup");
  await page.evaluate(() => ((window as unknown as { __tsFail: boolean }).__tsFail = true));
  const form = page.getByTestId("tool-form");
  await form.getByRole("textbox").fill("example.com");
  await form.getByRole("button").click();
  await expect(page.getByTestId("tool-status")).toContainText("couldn't verify you're human");
  expect(requests).toHaveLength(0);
  await page.evaluate(() => ((window as unknown as { __tsFail: boolean }).__tsFail = false));
  await form.getByRole("button").click();
  await expect(page.getByTestId("tool-status")).toContainText("This tool is paused");
});

test("a blocked Turnstile script shows the busy state, not a failed human check", async ({ page }) => {
  const requests = await setup(page, () => ({ status: 200, json: {} }));
  await page.unroute("https://challenges.cloudflare.com/**");
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.goto("/tools/dns-lookup");
  const form = page.getByTestId("tool-form");
  await form.getByRole("textbox").fill("example.com");
  await form.getByRole("button").click();
  await expect(page.getByTestId("tool-status")).toContainText("busy right now");
  expect(requests).toHaveLength(0);
});

test("target-controlled strings render as text, and og:image loads only on click without a referrer", async ({ page }) => {
  const evil = '<img src=x onerror="window.__xss=1">';
  await setup(page, () =>
    ok("social", {
      status: 200,
      finalUrl: "https://example.com/",
      tags: { "og:title": evil, "og:image": "https://cdn.example.com/i.png" },
      title: evil,
      description: "javascript:alert(1)",
      truncated: false,
      missing: [],
      image: { url: "https://cdn.example.com/i.png", reachable: true, reason: null, contentType: "image/png", bytes: 10, loadable: true },
    }),
  );
  let imageLoaded = false;
  await page.route("https://cdn.example.com/**", (route) => {
    imageLoaded = true;
    return route.fulfill({ contentType: "image/png", body: Buffer.from([]) });
  });
  await page.goto("/tools/social-preview-checker");
  await page.getByTestId("tool-form").getByRole("textbox").fill("example.com");
  await page.getByTestId("tool-form").getByRole("button").click();
  await expect(page.getByTestId("social-card")).toContainText(evil);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.getByTestId("tool-result").locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(imageLoaded).toBe(false);
  await page.getByRole("button", { name: "Show image" }).click();
  await expect(page.getByTestId("social-image")).toHaveAttribute("referrerpolicy", "no-referrer");
});

test("share link is offered only for inputs without a query string and pre-fills without running", async ({ page }) => {
  const requests = await setup(page, () => ok("uptime", { up: true, status: 200, timeMs: 1, finalUrl: "https://example.com/", hops: [] }));
  await page.goto("/tools/website-uptime-checker?url=example.com");
  await expect(page.getByTestId("tool-form").getByRole("textbox")).toHaveValue("example.com");
  expect(requests).toHaveLength(0);
  await page.getByTestId("tool-form").getByRole("button").click();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await page.getByTestId("tool-form").getByRole("textbox").fill("https://example.com/?token=secret");
  await page.getByTestId("tool-form").getByRole("button").click();
  await expect(page.getByTestId("tool-verdict")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toHaveCount(0);
});

test("result region is aria-live and the form works by keyboard", async ({ page }) => {
  await setup(page, () => ok("dns", { domain: "example.com", resolves: false, count: 0, records: {}, dnssec: false, failedQueries: 0 }));
  await page.goto("/tools/dns-lookup");
  await expect(page.getByTestId("tool-status")).toHaveAttribute("aria-live", "polite");
  await page.getByLabel("Domain").focus();
  await page.keyboard.type("nx.example");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tool-verdict")).toContainText("Domain does not resolve");
});
