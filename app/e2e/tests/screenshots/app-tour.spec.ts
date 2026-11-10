/**
 * PR screenshot tour.
 *
 * Runs only in the `screenshots` project against a throwaway self-hosted app booted
 * inside the pull request job (.github/workflows/pr-screenshots.yml). Saves one PNG
 * per app route for the gallery, and fails if a route is neither toured nor skipped.
 * No content assertions beyond reaching each page.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { captureFailure, captureScreenshot, SCREENSHOT_SEED } from '../../utils/screenshot';
import { waitForHydration } from '../../utils/hydration';

type Seed = { test: string; job: string; monitor: string; statusPage: string; requirement: string; incident: string };
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

/**
 * One frame per app route, keyed by its folder under app/src/app/(main). `dark` adds a
 * dark-theme frame for the pages people look at most. Every route must appear here or in
 * SKIPPED, so a new page cannot silently miss the review gallery.
 */
// `path` can look an id up through the API for records the seed SQL created.
const PAGES: Array<{ route: string; name: string; path?: (s: Seed, api: APIRequestContext) => string | Promise<string>; dark?: boolean }> = [
  // Old URLs that redirect to a tab are toured at the tab itself.
  { route: '/', name: 'dashboard', dark: true },
  { route: '/connected-apps', name: 'connected-apps' },
  { route: '/copilot', name: 'copilot' },
  { route: '/create', name: 'create' },
  { route: '/incidents', name: 'incidents' },
  { route: '/incidents/[id]', name: 'incident-detail', path: (s) => `/incidents/${s.incident}` },
  { route: '/incidents/analytics', name: 'incidents-analytics' },
  { route: '/jobs', name: 'jobs-list' },
  { route: '/jobs/create', name: 'job-create' },
  { route: '/jobs/create/k6', name: 'job-create-k6' },
  { route: '/jobs/create/playwright', name: 'job-create-playwright' },
  { route: '/jobs/edit/[id]', name: 'job-edit', path: (s) => `/jobs/edit/${s.job}` },
  { route: '/monitors', name: 'monitors-list', dark: true },
  { route: '/monitors/create', name: 'monitor-create' },
  { route: '/monitors/[id]', name: 'monitor-detail', path: (s) => `/monitors/${s.monitor}` },
  { route: '/monitors/[id]/edit', name: 'monitor-edit', path: (s) => `/monitors/${s.monitor}/edit` },
  { route: '/notifications', name: 'notifications' },
  { route: '/alerts', name: 'notifications-history', path: () => '/notifications?tab=history' },
  { route: '/org-admin', name: 'org-admin' },
  { route: '/org-admin/integrations', name: 'org-admin-integrations', path: () => '/org-admin?tab=integrations' },
  { route: '/org-admin/private-agents', name: 'org-admin-private-agents', path: () => '/org-admin?tab=private-agents' },
  { route: '/org-admin/runbooks', name: 'org-admin-saved-queries', path: () => '/org-admin?tab=integrations&section=saved-queries' },
  { route: '/playground', name: 'playground' },
  { route: '/playground/[id]', name: 'test-editor', path: (s) => `/playground/${s.test}` },
  { route: '/requirements', name: 'requirements' },
  { route: '/requirements/new', name: 'requirement-new' },
  { route: '/requirements/[id]', name: 'requirement-detail', path: (s) => `/requirements?id=${s.requirement}` },
  { route: '/requirements/edit/[id]', name: 'requirement-edit', path: (s) => `/requirements/edit/${s.requirement}` },
  { route: '/runs', name: 'runs', dark: true },
  { route: '/runs/[id]', name: 'run-detail-failed', path: async (_, api) => `/runs/${await firstId(api, '/api/runs?status=failed', 'data')}` },
  { route: '/services', name: 'services' },
  { route: '/services/[serviceId]', name: 'service-detail', path: async (_, api) => `/services/${await firstId(api, '/api/sre/services', 'services')}` },
  { route: '/status-pages', name: 'status-pages-list' },
  { route: '/status-pages/[id]', name: 'status-page-detail', path: (s) => `/status-pages/${s.statusPage}` },
  { route: '/status-pages/[id]/public', name: 'status-page-public', path: (s) => `/status-pages/${s.statusPage}/public` },
  { route: '/tests', name: 'tests-list' },
  { route: '/tests/create', name: 'test-create' },
  { route: '/variables', name: 'variables' },
];

/** Routes left out on purpose, with the reason. */
const SKIPPED: Record<string, string> = {
  '/billing': 'cloud billing only; the self-hosted tour app has no billing',
  '/billing/success': 'cloud billing only; the self-hosted tour app has no billing',
  '/copilot/investigations': 'redirects to /incidents, which is toured',
  '/status-pages/[id]/public/incidents/[incidentId]': 'needs a status page incident, which the seed does not create',
};

async function firstId(api: APIRequestContext, url: string, key: string): Promise<string> {
  const response = await api.get(url);
  expect(response.ok(), `${url} returned ${response.status()}`).toBe(true);
  const id = ((await response.json()) as Record<string, Array<{ id?: string }>>)[key]?.[0]?.id;
  expect(id, `${url} returned no records`).toBeTruthy();
  return id as string;
}

const APP_ROUTES = path.resolve(__dirname, '../../../src/app/(main)');
function appRoutes(dir = APP_ROUTES, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return /^page\.(tsx?|jsx?|mdx)$/.test(entry.name) ? [prefix || '/'] : [];
    // Private folders and parallel-route slots are not URL segments of their own pages.
    if (/^[_@]/.test(entry.name)) return [];
    // Route groups like (settings) add no URL segment; intercepting routes like (.)x are not pages.
    if (/^\(\.+\)/.test(entry.name)) return [];
    const segment = /^\(.*\)$/.test(entry.name) ? '' : `/${entry.name}`;
    return appRoutes(path.join(dir, entry.name), prefix + segment);
  });
}

test('every app route is in the tour or skipped with a reason', () => {
  const covered = new Set([...PAGES.map((p) => p.route), ...Object.keys(SKIPPED)]);
  const routes = appRoutes();
  expect(routes.length).toBeGreaterThan(10);
  expect(routes.filter((route) => !covered.has(route)), 'Add these routes to PAGES or SKIPPED in app-tour.spec.ts').toEqual([]);
  expect([...covered].filter((route) => !routes.includes(route)), 'These routes no longer exist').toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });
    for (const entry of PAGES.filter((p) => colorScheme === 'light' || p.dark)) {
      const shot = colorScheme === 'dark' ? `${entry.name}-dark` : entry.name;
      test(shot, async ({ page }, testInfo) => {
        const target = entry.path ? await entry.path(seed(), page.request) : entry.route;
        const response = await page.goto(target);
        expect(response?.status() ?? 0).toBeLessThan(400);
        // Any redirect (to sign-in, or a list page after a failed lookup) would publish the
        // wrong page under this name, so the browser must land exactly where the tour asked.
        const landed = new URL(page.url());
        expect(landed.pathname + landed.search).toBe(target);
        await waitForHydration(page);
        await captureScreenshot(page, testInfo, shot);
      });
    }
  });
}
