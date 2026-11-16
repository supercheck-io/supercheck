import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  chooseProfile,
  expectStep,
  next,
  purgeCreatedItems,
  signUpFreshCreator,
  stepButton,
  wizard,
} from '../../utils/setup-test-data';

test.describe('Project setup self-hosted @setup', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser, baseURL, playwright }) => {
    const api = await playwright.request.newContext({ baseURL });
    const res = await api.get('/api/config/app');
    const selfHosted = res.ok() && ((await res.json()) as { hosting?: { selfHosted?: boolean } }).hosting?.selfHosted === true;
    await api.dispose();
    test.skip(!selfHosted, 'project setup billing rules differ on a cloud deployment');

    const creator = await signUpFreshCreator(browser, baseURL ?? '', 'selfhosted');
    context = creator.context;
    page = creator.page;
  });

  test.afterAll(async () => {
    if (!page) return;
    await purgeCreatedItems(page.request);
    await context.close();
  });

  test('sign-up lands on /setup with no subscribe step, no plan cap @critical', async () => {
    await expect(page).toHaveURL(/\/setup/);
    await expect(page).not.toHaveURL(/\/subscribe/);
    await chooseProfile(page, 'Keep production up');

    await expectStep(page, 'app');
    await wizard(page).getByLabel('App URL').fill('https://example.com');
    await next(page);
    await stepButton(page, 'monitors').click();
    await expectStep(page, 'monitors');
    await expect(page.getByTestId('setup-monitor-cap')).toHaveCount(0);
    await expect(wizard(page)).not.toContainText(/upgrade|plan allows/i);
    // The AI steps (tests, aiSre) appear only when a provider is configured, so they are not asserted either way.
  });
});
