/**
 * Setup for the PR screenshot tour: signs up a fresh user on the throwaway app, seeds
 * realistic demo data through the app's own API and UI, and saves the session plus the
 * seeded IDs for app-tour.spec.ts. Run and check history, which only the worker creates,
 * comes from seed-history.sql afterwards. Names are fixed so frames compare between runs.
 */
import { writeFile } from 'node:fs/promises';
import { expect, test as setup, type APIRequestContext, type Page } from '@playwright/test';
import { SignUpPage } from '../../pages/auth';
import { getAuthRetryDelayMs } from '../../utils/api-auth';
import { waitForHydration } from '../../utils/hydration';
import { createJob, createMonitor, createTest } from '../../utils/test-data';
import { createStatusPageThroughUi } from '../../utils/status-page-test-data';
import { SCREENSHOT_AUTH_STATE, SCREENSHOT_IDENTITIES, SCREENSHOT_SEED, SCREENSHOT_USER } from '../../utils/screenshot';

async function ok<T>(label: string, response: Awaited<ReturnType<APIRequestContext['post']>>): Promise<T> {
  if (!response.ok()) throw new Error(`Seeding ${label} failed: ${response.status()} ${await response.text()}`);
  return (await response.json()) as T;
}

/** Finds the first string id anywhere a create response usually puts it. */
function idOf(body: unknown): string {
  const b = body as Record<string, { id?: unknown } | unknown>;
  for (const value of [b.id, ...Object.values(b).map((v) => (v as { id?: unknown } | null)?.id)]) {
    if (typeof value === 'string' && value) return value;
  }
  throw new Error(`No id in ${JSON.stringify(body).slice(0, 200)}`);
}

async function createService(page: Page, name: string, environment: string): Promise<void> {
  await page.goto('/services');
  await waitForHydration(page);
  await page.getByTestId('add-service-btn').click();
  const dialog = page.getByRole('dialog', { name: /add service/i });
  await dialog.getByLabel('Service name *').fill(name);
  await dialog.getByLabel('Environment').fill(environment);
  await dialog.getByTestId('submit-service-btn').click();
  await expect(dialog).toBeHidden();
}

setup('sign up and seed screenshot data', async ({ page, baseURL, playwright }) => {
  setup.setTimeout(420_000);
  // The tour signs up a fixed account and never cleans up, so it only targets a throwaway local app.
  const host = new URL(baseURL ?? '').hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    throw new Error(`Screenshot tour only runs against a disposable local app, not ${host}`);
  }
  const signUp = new SignUpPage(page);
  await signUp.navigate();
  await signUp.signUpWithEmail(SCREENSHOT_USER.name, SCREENSHOT_USER.email, SCREENSHOT_USER.password);
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-up'), { timeout: 60_000 });

  // Sign-up provisions the default organization and project asynchronously.
  let projectId = '';
  await expect
    .poll(async () => {
      const res = await page.request.get('/api/projects');
      if (!res.ok()) return undefined;
      projectId = ((await res.json()) as { currentProject?: { id?: string } }).currentProject?.id ?? '';
      return projectId;
    }, { timeout: 60_000 })
    .toBeTruthy();
  const api = page.request;
  const headers = { 'x-project-id': projectId };

  // Tests of each kind, tagged, so lists, filters and the editor have content.
  const checkout = await createTest(api, {
    title: 'Checkout flow',
    type: 'browser',
    description: 'Adds an item to the cart and pays with a test card',
    script: "import { test, expect } from '@playwright/test';\n\ntest('checkout', async ({ page }) => {\n  await page.goto('https://example.com');\n  await expect(page).toHaveTitle(/Example/);\n});\n",
  });
  const healthApi = await createTest(api, { title: 'Orders API health', type: 'api', priority: 'high', description: 'GET /health returns 200' });
  const signIn = await createTest(api, { title: 'Sign-in smoke', type: 'browser', priority: 'low', description: 'Signs in with a demo account' });
  const tags: string[] = [];
  for (const [name, color] of [['checkout', '#16a34a'], ['smoke', '#2563eb'], ['critical', '#dc2626']]) {
    tags.push(idOf(await ok('tag', await api.post('/api/tags', { headers, data: { name, color } }))));
  }
  await ok('test tags', await api.post(`/api/tests/${checkout.id}/tags`, { headers, data: { tagIds: [tags[0], tags[2]] } }));
  await ok('test tags', await api.post(`/api/tests/${signIn.id}/tags`, { headers, data: { tagIds: [tags[1]] } }));

  // No cron schedule: the throwaway app has no worker, so jobs never run.
  const job = await createJob(api, { name: 'Nightly regression', testId: checkout.id });
  await createJob(api, { name: 'API smoke', testId: healthApi.id });

  const monitor = await createMonitor(api, { name: 'Marketing site' });
  await createMonitor(api, { name: 'Docs website', type: 'website', target: 'https://example.org/' });
  await createMonitor(api, { name: 'DNS resolver', type: 'ping_host', target: '1.1.1.1' });
  await createMonitor(api, { name: 'Postgres port', type: 'port_check', target: 'example.net', config: { port: 5432, protocol: 'tcp' } });

  const requirement = idOf(await ok('requirement', await api.post('/api/requirements', {
    headers,
    data: { title: 'Customers can pay by card', description: 'Checkout accepts Visa and Mastercard.', priority: 'high', testIds: [checkout.id] },
  })));
  await ok('requirement', await api.post('/api/requirements', {
    headers,
    data: { title: 'Password reset email arrives within a minute', priority: 'medium' },
  }));

  await ok('variable', await api.post(`/api/projects/${projectId}/variables`, { headers, data: { key: 'BASE_URL', value: 'https://shop.example.com', description: 'Storefront under test', isSecret: false } }));
  await ok('secret', await api.post(`/api/projects/${projectId}/variables`, { headers, data: { key: 'API_TOKEN', value: 'demo-token-not-real', description: 'Orders API token', isSecret: true } }));

  // Creating a provider sends nothing; example.com and the fake Slack URL never receive mail or posts.
  await ok('email channel', await api.post('/api/notification-providers', { headers, data: { type: 'email', config: { name: 'On-call email', emails: 'oncall@example.com' } } }));
  await ok('slack channel', await api.post('/api/notification-providers', { headers, data: { type: 'slack', config: { name: '#alerts', webhookUrl: 'https://hooks.slack.com/services/T000/B000/demo' } } }));

  // The tour keeps its data; the database is discarded with the CI job.
  const statusPage = await createStatusPageThroughUi(page, api, { add() {} }, 'Demo');
  await ok('status page component', await api.post(`/api/status-pages/${statusPage.id}/components`, {
    headers,
    data: { name: 'Storefront', description: 'Public website and checkout', monitorIds: [monitor.id], status: 'operational' },
  }));
  await ok('status page component', await api.post(`/api/status-pages/${statusPage.id}/components`, {
    headers,
    data: { name: 'Orders API', status: 'degraded_performance' },
  }));

  // SRE services and an incident have no JSON create route; use the UI like the AI SRE specs.
  await createService(page, 'checkout-api', 'production');
  await createService(page, 'payments-worker', 'production');
  await page.goto('/incidents');
  await waitForHydration(page);
  await page.getByRole('button', { name: 'New incident' }).click();
  const incidentDialog = page.getByRole('dialog', { name: 'Create incident' });
  await incidentDialog.getByLabel('Title').fill('Checkout latency above 2s');
  await incidentDialog.getByLabel('Initial notes').fill('p95 latency on checkout-api rose after the 14:00 deploy.');
  await incidentDialog.getByRole('button', { name: 'Create incident' }).click();
  await page.waitForURL(/\/incidents\/[0-9a-f-]{36}$/);
  const incident = new URL(page.url()).pathname.split('/').pop() ?? '';
  await ok('incident acknowledge', await api.post(`/api/sre/incidents/${incident}/acknowledge`, { headers }));

  // Accounts for the E2E checkpoint run. API sign-up creates only the user; the browser flow
  // provisions a workspace through setup-defaults. The four role accounts skip that and join
  // this organization in seed-history.sql instead, like invited members; the others get
  // their own workspace.
  const members = new Set(['orgAdmin', 'projectAdmin', 'editor', 'viewer']);
  for (const [key, identity] of Object.entries(SCREENSHOT_IDENTITIES)) {
    const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL ?? '' } });
    // Auth rate-limits sign-ups per address; wait out each window instead of failing the seed.
    let signUp = await context.post('/api/auth/sign-up/email', { data: identity });
    for (let attempt = 1; signUp.status() === 429 && attempt <= 8; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, getAuthRetryDelayMs(signUp, attempt)));
      signUp = await context.post('/api/auth/sign-up/email', { data: identity });
    }
    await ok(`sign-up ${identity.email}`, signUp);
    if (!members.has(key)) {
      await ok(`workspace ${identity.email}`, await context.post('/api/auth/setup-defaults'));
      await expect
        .poll(async () => {
          const res = await context.get('/api/projects');
          return res.ok() ? ((await res.json()) as { currentProject?: { id?: string } }).currentProject?.id : undefined;
        }, { timeout: 60_000 })
        .toBeTruthy();
    }
    await context.dispose();
  }

  const seed = { test: checkout.id, job: job.id, monitor: monitor.id, statusPage: statusPage.id, requirement, incident };
  await writeFile(SCREENSHOT_SEED, JSON.stringify(seed));
  await page.context().storageState({ path: SCREENSHOT_AUTH_STATE });
});
