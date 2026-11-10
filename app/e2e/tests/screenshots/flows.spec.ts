/**
 * Key user flows for the PR screenshot gallery: each test walks a flow on the seeded
 * throwaway app and saves a numbered frame at each important step (`flow-<flow>-<n>-<step>`).
 * Dialogs are opened and filled but left unsubmitted where submitting would change data the
 * page tour relies on. A broken step fails the test and saves `failed-<test>.png`.
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
