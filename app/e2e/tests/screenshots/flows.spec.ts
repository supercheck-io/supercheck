/**
 * Key user flows for the PR screenshot gallery: each test walks a flow on the seeded
 * throwaway app and saves a numbered frame at each important step (`flow-<flow>-<n>-<step>`).
 * Dialogs are opened and filled but left unsubmitted where submitting would change data the
 * page tour relies on. A broken step fails the test and saves `failed-<test>.png`.
 * `invalid-…` flows end on an error screen on purpose; the gallery tags them "Negative test".
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { captureFailure, captureScreenshot, SCREENSHOT_SEED } from '../../utils/screenshot';
import { waitForHydration } from '../../utils/hydration';

type Seed = { statusPage: string };
const seed = (): Seed => JSON.parse(readFileSync(SCREENSHOT_SEED, 'utf8')) as Seed;

test.afterEach(async ({ page }, testInfo) => captureFailure(page, testInfo));

function frames(page: Page, testInfo: TestInfo, flow: string) {
  let n = 0;
  return (step: string) => captureScreenshot(page, testInfo, `flow-${flow}-${++n}-${step}`);
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForHydration(page);
}

test('command menu', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'command-menu');
  await open(page, '/');
  await page.getByRole('button', { name: 'Open command menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Command Menu' });
  await expect(menu).toBeVisible();
  await frame('open');
  await menu.getByPlaceholder('Type a command or search...').fill('monitor');
  await frame('search');
});

test('create HTTP monitor', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'create-monitor');
  await open(page, '/monitors/create');
  await frame('choose-type');
  await open(page, '/monitors/create?type=http_request');
  await page.getByLabel(/^(Monitor )?Name/).first().fill('Checkout API');
  await page.getByLabel(/^(URL|Target)/).first().fill('https://shop.example.com/api/health');
  await frame('filled');
});

test('new status update', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'status-update');
  await open(page, `/status-pages/${seed().statusPage}`);
  await page.getByRole('tab', { name: 'Components' }).click();
  await frame('components');
  await page.getByRole('tab', { name: 'Status updates' }).click();
  await page.getByRole('button', { name: 'New status update' }).click();
  const dialog = page.getByRole('dialog', { name: 'New status update' });
  await dialog.getByLabel('Title *').fill('Degraded checkout performance');
  await dialog.getByLabel('Initial Message *').fill('We are investigating slow checkout requests.');
  await frame('dialog');
});

test('new incident', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'new-incident');
  await open(page, '/incidents');
  await page.getByRole('button', { name: 'New incident' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create incident' });
  await dialog.getByLabel('Title').fill('Payments worker queue backlog');
  await dialog.getByLabel('Initial notes').fill('Queue depth above 5k for 10 minutes.');
  await frame('dialog');
});

test('invite member', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'invite-member');
  await open(page, '/org-admin?tab=members');
  await frame('members');
  await page.getByRole('button', { name: 'Invite Member' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByLabel(/email/i).first().fill('teammate@example.com');
  await frame('dialog');
});

test('add variable', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'add-variable');
  await open(page, '/variables');
  await page.getByRole('button', { name: 'Add Variable' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await frame('dialog');
});

test('playground templates', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'playground');
  await open(page, '/playground');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await frame('templates');
});

test('create status page', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'create-status-page');
  await open(page, '/status-pages');
  await page.getByTestId('create-status-page-button').click();
  const dialog = page.getByRole('dialog', { name: 'Create Status Page' });
  await dialog.getByPlaceholder('My Service Status').fill('Checkout status');
  await dialog.getByPlaceholder('Service Status Dashboard').fill('Checkout and payments');
  await frame('dialog');
});

// Error paths: each submits bad input, which the app must reject without saving anything.
test('invalid monitor URL', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'invalid-monitor-url');
  await open(page, '/monitors/create?type=http_request');
  await page.getByLabel(/^(Monitor )?Name/).first().fill('Checkout API');
  await page.getByLabel(/^(URL|Target)/).first().fill('not-a-url');
  await page.getByRole('button', { name: /^Next:/ }).click();
  await expect(page.getByText(/Target must be a valid http/)).toBeVisible();
  await frame('error');
});

test('invalid status page', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'invalid-status-page');
  await open(page, '/status-pages');
  await page.getByTestId('create-status-page-button').click();
  const dialog = page.getByRole('dialog', { name: 'Create Status Page' });
  await dialog.getByRole('button', { name: 'Create Status Page' }).click();
  await expect(dialog.getByText('Name is required')).toBeVisible();
  await frame('error');
});

test('invalid monitor id', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'invalid-monitor-id');
  await open(page, '/monitors/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible();
  await frame('not-found');
});

test('incident lifecycle', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const frame = frames(page, testInfo, 'incident-lifecycle');
  await open(page, '/incidents');
  await page.getByRole('button', { name: 'New incident' }).click();
  const create = page.getByRole('dialog', { name: 'Create incident' });
  await create.getByLabel('Title').fill('Card payments failing for EU customers');
  await create.getByLabel('Initial notes').fill('Stripe returns 402 for about 8% of EU card payments since 09:10.');
  await create.getByRole('button', { name: 'Create incident', exact: true }).click();
  await page.waitForURL(/\/incidents\/[0-9a-f-]{36}$/);
  await waitForHydration(page);
  await frame('triggered');

  // The brief comes from the stand-in AI provider (app/e2e/scripts/mock-ai.mjs).
  // A first click can land before nested panels hydrate, so retry until the tab shows.
  await expect(async () => {
    await page.getByRole('tab', { name: 'Investigation', exact: true }).click();
    await expect(page).toHaveURL(/[?&]tab=investigation/, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Generate brief', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Regenerate brief', exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await frame('brief');

  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Resolve incident' }).first()).toBeVisible({ timeout: 30_000 });
  await frame('acknowledged');

  await page.getByRole('button', { name: 'Resolve incident' }).first().click();
  const resolve = page.getByRole('dialog', { name: 'Resolve incident' });
  await resolve.getByLabel('What confirmed recovery?').fill('Rolled back the payment client; EU card success rate is back to 99.6%.');
  await frame('resolve-dialog');
  await resolve.getByRole('button', { name: /resolve/i }).last().click();
  await expect(resolve).toBeHidden({ timeout: 30_000 });
  await frame('resolved');

  // The tab appears once the resolved incident refetches.
  await page.getByRole('tab', { name: 'Post-mortem', exact: true }).click();
  const draft = page.getByRole('button', { name: 'Generate post-mortem draft' });
  await expect(draft).toBeVisible();
  await draft.click();
  await expect(page.getByText('No post-mortem yet')).toBeHidden({ timeout: 60_000 });
  await frame('post-mortem');
});

test('copilot answer', async ({ page }, testInfo) => {
  const frame = frames(page, testInfo, 'copilot');
  await open(page, '/copilot');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.getByRole('textbox').last().fill('Why is checkout slow since the last deploy?');
  await frame('prompt');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Likely cause:')).toBeVisible({ timeout: 60_000 });
  await frame('answer');
});

// The connector form for each kind of source a reviewer is likely to touch. Nothing is saved.
for (const connector of ['GitHub', 'Kubernetes', 'Prometheus', 'Grafana', 'Datadog', 'Sentry', 'PagerDuty', 'MCP']) {
  test(`connector ${connector}`, async ({ page }, testInfo) => {
    const frame = frames(page, testInfo, `connector-${connector.toLowerCase()}`);
    await open(page, '/org-admin?tab=integrations');
    await page.getByRole('button', { name: 'Add connector', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add connector' });
    await dialog.getByLabel('Connector type').click();
    if (connector === 'GitHub') await frame('catalog');
    await page.getByRole('option', { name: connector, exact: true }).click();
    await frame('form');
  });
}
