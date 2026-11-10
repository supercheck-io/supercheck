/**
 * PR screenshot tour.
 *
 * Runs only in the `screenshots` project against a throwaway self-hosted app booted
 * inside the pull request job (.github/workflows/pr-screenshots.yml). Saves one PNG
 * per page for the gallery. No content assertions beyond reaching each page.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { captureFailure, captureScreenshot, SCREENSHOT_SEED } from '../../utils/screenshot';
import { waitForHydration } from '../../utils/hydration';

type Seed = { test: string; monitor: string; statusPage: string };
const seed = (): Seed => JSON.parse(readFileSync(SCREENSHOT_SEED, 'utf8')) as Seed;

test.afterEach(async ({ page }, testInfo) => captureFailure(page, testInfo));

test.describe('public pages', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const name of ['sign-in', 'sign-up']) {
    test(name, async ({ page }, testInfo) => {
      await page.goto(`/${name}`);
      await waitForHydration(page);
      await captureScreenshot(page, testInfo, name);
    });
  }
});

const PAGES: Array<{ name: string; path: (s: Seed) => string; dark?: boolean }> = [
  { name: 'dashboard', path: () => '/', dark: true },
  { name: 'tests-list', path: () => '/tests' },
  { name: 'test-editor', path: (s) => `/playground/${s.test}` },
  { name: 'jobs-list', path: () => '/jobs' },
  { name: 'monitors-list', path: () => '/monitors', dark: true },
  { name: 'monitor-detail', path: (s) => `/monitors/${s.monitor}` },
  { name: 'status-pages-list', path: () => '/status-pages' },
  { name: 'status-page-detail', path: (s) => `/status-pages/${s.statusPage}` },
  { name: 'notifications', path: () => '/notifications' },
  { name: 'variables', path: () => '/variables' },
  { name: 'org-admin', path: () => '/org-admin' },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });
    for (const entry of PAGES.filter((p) => colorScheme === 'light' || p.dark)) {
      const shot = colorScheme === 'dark' ? `${entry.name}-dark` : entry.name;
      test(shot, async ({ page }, testInfo) => {
        const target = entry.path(seed());
        const response = await page.goto(target);
        expect(response?.status() ?? 0).toBeLessThan(400);
        // A rejected session redirects to sign-in; never publish that under this page's name.
        expect(new URL(page.url()).pathname).toBe(target);
        await waitForHydration(page);
        await captureScreenshot(page, testInfo, shot);
      });
    }
  });
}
