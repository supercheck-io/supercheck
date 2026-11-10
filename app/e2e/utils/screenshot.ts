import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

// Throwaway identity for the PR screenshot app; its database lives only in the CI job.
export const SCREENSHOT_USER = {
  name: 'Riley Reviewer',
  email: 'reviewer@example.com',
  password: 'Screenshot-Tour-2026!',
};
export const SCREENSHOT_AUTH_STATE = path.resolve(__dirname, '../screenshots-auth-state.json');
export const SCREENSHOT_SEED = path.resolve(__dirname, '../screenshots-seed.json');

// The PR gallery rejects very tall images, so long pages are split into parts.
const MAX_SCREENSHOT_HEIGHT = 9_000;

// Values that differ on every run (timestamps, generated IDs, the id-seeded default avatar)
// are masked so the gallery's SHA-256 comparison only flags real UI changes.
const VOLATILE = ['time', '[data-slot="avatar"]', ':has(> [aria-label="Copy ID"]) > code'].join(', ');

/**
 * Save a full-page PNG into the test's output folder for the PR screenshot gallery.
 * File names become gallery captions, so use kebab-case like `monitors-list`.
 */
export async function captureScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`Screenshot name must be kebab-case: ${name}`);
  }
  // Let fonts, images and client data settle so frames are comparable between runs.
  // Pages with live updates never go fully idle, so cap the wait instead of failing.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);

  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight,
  }));
  const parts = Math.max(1, Math.ceil(height / MAX_SCREENSHOT_HEIGHT));
  for (let part = 0; part < parts; part++) {
    const y = part * MAX_SCREENSHOT_HEIGHT;
    await page.screenshot({
      path: testInfo.outputPath(`${part === 0 ? name : `${name}-${part + 1}`}.png`),
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      scale: 'css',
      clip: { x: 0, y, width, height: Math.min(MAX_SCREENSHOT_HEIGHT, height - y) },
      // Status page URLs carry a generated id.
      mask: [page.locator(VOLATILE), page.getByText(/\/status\/[0-9a-f]{8}/)],
      maskColor: '#9ca3af',
    });
  }
}

/**
 * Save what the page showed when a tour test failed, as `failed-<test>.png`.
 * The gallery lists these under "Failed", apart from intentional checkpoints.
 */
export async function captureFailure(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;
  // The gallery accepts at most 100 characters before `.png`.
  const slug = testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 93);
  const name = `failed-${slug || 'test'}`;
  // Viewport only: a broken page may have no sensible full-page height.
  await page
    .screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled', caret: 'hide', timeout: 10_000 })
    .catch(() => undefined);
}
