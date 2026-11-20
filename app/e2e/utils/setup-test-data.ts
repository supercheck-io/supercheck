import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { SignUpPage } from '../pages/auth';
import { generateTestPassword } from './env';
import { ENV_GATED } from '../reporters/priority-skip-reporter';
import { waitForHydration } from './hydration';

const SIGN_UP_REASON = 'needs a self-hosted target; a cloud deployment does not allow fresh users';
/** Describe option for specs that sign fresh users up: their skip on a cloud target is listed as a warning, not a gate failure. */
export const SIGN_UP_GATED = { annotation: { type: ENV_GATED, description: SIGN_UP_REASON } };

async function signUpIsClosed(baseURL: string): Promise<boolean> {
  const res = await fetch(new URL('/api/config/app', baseURL));
  if (!res.ok) throw new Error(`/api/config/app answered ${res.status}`);
  return ((await res.json()) as { hosting?: { selfHosted?: boolean } }).hosting?.selfHosted !== true;
}

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
  test.skip(await signUpIsClosed(baseURL), SIGN_UP_REASON);
  // A dropped submit is retried once, and each attempt waits for the form and the request.
  test.setTimeout(180_000);
  // Playwright applies the project's signed-in storageState to new contexts; start signed out.
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const signUp = new SignUpPage(page);
  const isSignUp = (url: string, method: string) => url.includes('/api/auth/sign-up/email') && method === 'POST';
  // What the page did, so a failure says whether the click, the request or the answer went missing.
  const trail: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && !r.url().includes('/_next/')) trail.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  page.on('console', (m) => { if (m.type() === 'error') trail.push(`console.error ${m.text().slice(0, 160)}`); });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) trail.push(`navigated ${new URL(f.url()).pathname}`); });
  let email = '';
  for (let attempt = 0; ; attempt++) {
    email = `setup-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
    const password = generateTestPassword();
    trail.length = 0;
    await signUp.navigate();
    await waitForHydration(page);
    // The form mounts once the app config says sign-up is open; fill and keep the values before submitting.
    await signUp.expectEmailFormMode();
    await expect(signUp.submitButton).toBeEnabled();
    await signUp.nameInput.fill(`Setup ${label}`);
    await signUp.emailInput.fill(email);
    await signUp.passwordInput.fill(password);
    await expect(signUp.emailInput).toHaveValue(email);
    await expect(signUp.passwordInput).toHaveValue(password);
    // Wait on the real request: it is sent as soon as the click is handled, and its answer can take longer.
    const sent = page.waitForRequest((r) => isSignUp(r.url(), r.method()), { timeout: 20_000 }).catch(() => null);
    await signUp.submitButton.click();
    const request = await sent;
    if (!request) {
      const shown = (await signUp.errorMessage.first().textContent({ timeout: 1000 }).catch(() => null)) ?? 'none';
      const why = `sign-up never sent its request (attempt ${attempt + 1}; page ${new URL(page.url()).pathname}; form error: ${shown}; page activity: ${trail.join(' | ') || 'none'})`;
      expect(attempt, why).toBeLessThan(2);
      continue;
    }
    const res = await request.response();
    expect(res, `sign-up request got no answer (${trail.join(' | ')})`).not.toBeNull();
    // A 429 fails loudly: Compose sign-ups bypass the per-IP limiter (no trusted client IP), so one is a real regression.
    expect(res!.ok(), `sign-up answered ${res!.status()}`).toBe(true);
    break;
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

/**
 * Jump to a step through the rail. The AI steps sit between the others only when a provider is
 * configured (the CI app has a stand-in one), so flows that do not care about them jump past them.
 */
export async function goToStep(page: Page, key: string): Promise<void> {
  await stepButton(page, key).click();
  await expectStep(page, key);
}

export async function next(page: Page, name: 'Continue' | 'Skip this step' = 'Continue'): Promise<void> {
  await wizard(page).getByRole('button', { name, exact: true }).click();
}
