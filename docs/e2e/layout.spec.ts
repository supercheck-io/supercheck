import { expect, test } from "@playwright/test";

const PAGES = [
  "/tools",
  "/tools/bot",
  "/tools/website-uptime-checker",
  "/tools/api-endpoint-checker",
  "/tools/https-checker",
  "/tools/security-headers-checker",
  "/tools/agent-readiness-checker",
  "/tools/dns-lookup",
  "/tools/social-preview-checker",
  "/tools/domain-expiry-checker",
];

for (const path of PAGES) {
  test(`${path}: one h1, canonical without query, no horizontal overflow at 320px in light and dark`, async ({ page }) => {
    await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.setViewportSize({ width: 320, height: 800 });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${path}?url=example.com`);
      await expect(page.locator("h1")).toHaveCount(1);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical?.endsWith(path)).toBe(true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
}

test("without an API URL the tool pages show the methodology and a Supercheck link, no form", async ({ page }) => {
  test.skip(process.env.E2E_TOOLS === "configured", "needs the default (unconfigured) build");
  await page.goto("/tools/security-headers-checker");
  await expect(page.getByTestId("tool-unconfigured")).toContainText("This check runs in Supercheck");
  await expect(page.getByTestId("tool-form")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "How we check" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scoring rules" })).toBeVisible();
});
