import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { SignUpPage } from '../pages/auth';
import { generateTestPassword } from './env';
import { waitForHydration } from './hydration';

export type FreshCreator = {
  context: BrowserContext;
  page: Page;
  email: string;
  projectId: string;
};

/**
 * Signs up a brand-new user (new organization, default project, org_owner) through the real
 * sign-up page. Project setup state and the persona question are per user and per project, so a
 * fresh creator is the only way to reach the untouched welcome and wizard. Needs sign-up enabled,
 * as on any local self-hosted app; the accounts are throwaway and live in that app's database.
 */
export async function signUpFreshCreator(browser: Browser, baseURL: string, label: string): Promise<FreshCreator> {
  // The default 60 s hook budget is too tight for a sign-up that waits out the auth rate limit.
  test.setTimeout(180_000);
  // Playwright applies the project's signed-in storageState to new contexts; start signed out.
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const signUp = new SignUpPage(page);
  // Better Auth allows 3 sign-up calls per 10 s per address, and earlier specs in the same run use it too:
  // on a 429 wait out the window instead of sitting on the form until the hook times out.
  let email = '';
  for (let attempt = 0; ; attempt++) {
    email = `setup-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
    await signUp.navigate();
    await waitForHydration(page);
    const answered = page
      .waitForResponse((r) => r.url().includes('/api/auth/sign-up/email') && r.request().method() === 'POST', { timeout: 30_000 })
      .catch(() => null);
    await signUp.signUpWithEmail(`Setup ${label}`, email, generateTestPassword());
    const res = await answered;
    // A submit dropped before the form was ready sends no request: load the form again and retry.
    if (!res) {
      expect(attempt, 'sign-up never sent its request').toBeLessThan(3);
      continue;
    }
    if (res.status() !== 429) {
      expect(res.ok(), `sign-up answered ${res.status()}`).toBe(true);
      break;
    }
    expect(attempt, 'sign-up kept answering 429').toBeLessThan(3);
    const wait = Number(res.headers()['retry-after']) || 10;
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
  }
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-up'), { timeout: 60_000 });

  // Sign-up provisions the default organization and project asynchronously.
  let projectId = '';
  await expect
    .poll(async () => {
      const res = await page.request.get('/api/projects');
      if (!res.ok()) return '';
      projectId = ((await res.json()) as { currentProject?: { id?: string } }).currentProject?.id ?? '';
      return projectId;
    }, { timeout: 60_000 })
    .toBeTruthy();
  return { context, page, email, projectId };
}

/** First array in a list response, whether it is the body or a `data`/`monitors`-style field. */
function rows(body: unknown): Array<{ id: string; name?: string }> {
  if (Array.isArray(body)) return body;
  const found = Object.values((body ?? {}) as Record<string, unknown>).find(Array.isArray);
  return (found as Array<{ id: string; name?: string }> | undefined) ?? [];
}

async function listRows(request: APIRequestContext, url: string) {
  const res = await request.get(url);
  return res.ok() ? rows(await res.json()) : [];
}

/** Deletes everything the wizard creates in the fresh creator's project. Safe to call twice. */
export async function purgeCreatedItems(request: APIRequestContext): Promise<void> {
  for (const [list, remove] of [
    ['/api/status-pages', '/api/status-pages'],
    ['/api/monitors?limit=100', '/api/monitors'],
    ['/api/notification-providers', '/api/notification-providers'],
  ]) {
    for (const row of await listRows(request, list)) {
      const res = await request.delete(`${remove}/${row.id}`);
      if (!res.ok() && res.status() !== 404) throw new Error(`Cleanup of ${remove}/${row.id} failed: ${res.status()}`);
    }
  }
}

export async function monitorNames(request: APIRequestContext): Promise<string[]> {
  return (await listRows(request, '/api/monitors?limit=100')).map((row) => row.name ?? '');
}

/** Welcome question: pick a persona card by its title and start. */
export async function chooseProfile(page: Page, title: string): Promise<void> {
  const welcome = page.getByTestId('setup-welcome');
  await expect(welcome).toBeVisible({ timeout: 30_000 });
  await waitForHydration(page);
  await welcome.getByRole('radio', { name: new RegExp(title) }).click();
  await welcome.getByRole('button', { name: 'Start setup' }).click();
  await expect(page.getByTestId('setup-wizard')).toBeVisible();
}

export const stepButton = (page: Page, key: string) => page.getByTestId(`setup-step-${key}`);
export const wizard = (page: Page) => page.getByTestId('setup-wizard');

/** Wait until the step rail shows `key` as the current step. */
export async function expectStep(page: Page, key: string): Promise<void> {
  await expect(stepButton(page, key)).toHaveAttribute('aria-current', 'step');
}

export async function next(page: Page, name: 'Continue' | 'Skip this step' = 'Continue'): Promise<void> {
  await wizard(page).getByRole('button', { name, exact: true }).click();
}
