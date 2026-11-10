import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

// Throwaway identity for the PR screenshot app; its database lives only in the CI job.
export const SCREENSHOT_USER = {
  name: 'Riley Reviewer',
  email: 'reviewer@example.com',
  password: 'Screenshot-Tour-2026!',
};
/**
 * Throwaway role accounts for the E2E checkpoint run. screenshots.setup.ts signs them up and
 * seed-history.sql makes the role accounts members of the demo user's organization, matching
 * how the real E2E deployment invites them. The demo user is the organization owner.
 */
const ROLE_PASSWORD = 'Screenshot-Role-2026!';
export const SCREENSHOT_IDENTITIES = {
  superAdmin: { name: 'Sam Superadmin', email: 'super-admin@example.com', password: ROLE_PASSWORD },
  orgAdmin: { name: 'Ola Orgadmin', email: 'org-admin@example.com', password: ROLE_PASSWORD },
  projectAdmin: { name: 'Pat Projectadmin', email: 'project-admin@example.com', password: ROLE_PASSWORD },
  editor: { name: 'Eddie Editor', email: 'editor@example.com', password: ROLE_PASSWORD },
  viewer: { name: 'Vic Viewer', email: 'viewer@example.com', password: ROLE_PASSWORD },
  invitee: { name: 'Ivy Invitee', email: 'invitee@example.com', password: ROLE_PASSWORD },
  session: { name: 'Sid Session', email: 'session@example.com', password: ROLE_PASSWORD },
  security: { name: 'Sec Security', email: 'security@example.com', password: ROLE_PASSWORD },
};
export const SCREENSHOT_AUTH_STATE = path.resolve(__dirname, '../screenshots-auth-state.json');
export const SCREENSHOT_SEED = path.resolve(__dirname, '../screenshots-seed.json');

// The PR gallery rejects very tall images, so long pages are split into parts.
const MAX_SCREENSHOT_HEIGHT = 9_000;

// The id-seeded default avatar differs per sign-up; mask it.
export const VOLATILE_IMAGES = '[data-slot="avatar"]';

/**
 * Waits until the page has settled: network quiet, loading skeletons gone and every visible
 * chart drawn. Each wait is capped (about 10s in all), since live pages never go fully idle.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page
    .waitForFunction(
      () => {
        const shown = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        // Skeletons are `animate-pulse bg-muted` (ui/skeleton.tsx); charts draw an svg once sized.
        return (
          !Array.from(document.querySelectorAll('.animate-pulse.bg-muted')).some(shown) &&
          Array.from(document.querySelectorAll('.recharts-responsive-container')).filter(shown).every((c) => c.querySelector('svg'))
        );
      },
      null,
      { timeout: 3_000 },
    )
    .catch(() => undefined);
  await page
    .evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 2_000))]))
    .catch(() => undefined);
}

/**
 * Rewrites text that differs on every run (dates, times, generated IDs) to fixed values,
 * so the gallery's SHA-256 comparison only flags real UI changes. Rewriting keeps column
 * widths stable, which a mask drawn over varying text does not.
 */
export async function normalizeVolatileText(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Kept so restoreVolatileText can put the page back for a test that keeps running.
    const saved: Array<[Node, string | null]> = [];
    (window as unknown as { __volatileText?: typeof saved }).__volatileText = saved;
    const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';
    const WEEKDAY = '(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? )?';
    const rules: Array<[RegExp, string | ((m: string) => string)]> = [
      // "Tuesday, Nov 10, 2026", "Nov 10, 2026, 10:27 AM", "Nov 9 7:54 PM"
      [new RegExp(`\\b${WEEKDAY}${MONTH} \\d{1,2}(?:, \\d{4})?(?:,? (?:at )?\\d{1,2}:\\d{2}(?::\\d{2})?(?: ?[AP]M)?)?`, 'g'),
        // Keep the shape, so a short chart tick like "Oct 12" stays short.
        (m) => `Jan 1${/\d{4}/.test(m) ? ', 2026' : ''}${/:/.test(m) ? ' 12:00 PM' : ''}`],
      [/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g, '2026-01-01 12:00'],
      [/\b\d{1,2}:\d{2}(?::\d{2})? ?[AP]M\b/g, '12:00 PM'],
      // 24-hour clock times, such as chart time-axis ticks.
      [/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '12:00'],
      [/\b\d+ (?:second|minute|hour|day)s? ago\b/g, '5 minutes ago'],
      // UUIDs and long hex ids keep their shape so truncation looks the same.
      // E2E data names end in Date.now() plus a random suffix (see test-data.ts uniqueName).
      [/\b1\d{12}_[a-z0-9]{6,10}\b/g, '1700000000000_demo'],
      // Tables show IDs cut short in the DOM, like "019a1c50f…".
      [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{16,}\b|\b[0-9a-f-]{6,}(?=…|\.\.\.)/g, (m) => m.replace(/[0-9a-f]/g, '0')],
      // React renders `{id.substring(0, 12)}...` as its own text node, without the ellipsis.
      [/^(?=[^]*\d)(?=[^]*[a-f])[0-9a-f-]{8,}$/, (m) => m.replace(/[0-9a-f]/g, '0')],
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let text = node.nodeValue ?? '';
      for (const [pattern, value] of rules) text = text.replace(pattern, value as string);
      if (text !== node.nodeValue) {
        saved.push([node, node.nodeValue]);
        node.nodeValue = text;
      }
    }
  });
}

/** Undoes normalizeVolatileText, so a mid-flow checkpoint leaves the page as the test saw it. */
export async function restoreVolatileText(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as { __volatileText?: Array<[Node, string | null]> };
    for (const [node, value] of holder.__volatileText ?? []) node.nodeValue = value;
    delete holder.__volatileText;
  });
}

/**
 * Save a full-page PNG into the test's output folder for the PR screenshot gallery.
 * File names become gallery captions, so use kebab-case like `monitors-list`.
 */
export async function captureScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`Screenshot name must be kebab-case: ${name}`);
  }
  // Let fonts, charts and client data settle so frames are comparable between runs.
  await settle(page);
  await normalizeVolatileText(page);

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
      mask: [page.locator(VOLATILE_IMAGES)],
      maskColor: '#9ca3af',
    });
  }
}

/**
 * Save what the page showed when a tour test failed, as `failed-<test>.png`.
 * The gallery lists these under "Failed", apart from intentional checkpoints.
 */
export async function captureFailure(page: Page, testInfo: TestInfo): Promise<void> {
  // about:blank means the test never navigated (for example the route coverage check).
  if (testInfo.status === testInfo.expectedStatus || page.url() === 'about:blank') return;
  // The gallery accepts at most 100 characters before `.png`.
  const slug = testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 93);
  const name = `failed-${slug || 'test'}`;
  // Viewport only: a broken page may have no sensible full-page height.
  await page
    .screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled', caret: 'hide', timeout: 10_000 })
    .catch(() => undefined);
}
