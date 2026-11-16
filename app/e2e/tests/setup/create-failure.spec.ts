import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { captureFixturePage } from '../../fixtures/checkpoint.fixture';
import {
  chooseProfile,
  expectStep,
  goToStep,
  monitorNames,
  next,
  purgeCreatedItems,
  signUpFreshCreator,
  wizard,
} from '../../utils/setup-test-data';

test.describe('Project setup create failure @setup', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser, baseURL }) => {
    const creator = await signUpFreshCreator(browser, baseURL ?? '', 'failure');
    context = creator.context;
    page = creator.page;
  });

  // The creator's page is not a fixture, so save its frame when the test fails.
  test.afterEach(async () => {
    if (page && test.info().status !== test.info().expectedStatus) await captureFixturePage(page, 'creatorPage');
  });

  test.afterAll(async () => {
    // beforeAll can fail before the page exists.
    if (!page) return;
    await purgeCreatedItems(page.request);
    await context.close();
  });

  test('a failed monitor shows its error and Retry, the other item stays created, Retry succeeds without duplicates @critical', async () => {
    await chooseProfile(page, 'Keep production up');
    await expectStep(page, 'app');
    await wizard(page).getByLabel('App URL').fill('https://example.com');
    await next(page);
    await expectStep(page, 'alerts');
    await next(page, 'Skip this step');

    // Homepage (ticked by default) plus one more page: two monitors to create.
    await expectStep(page, 'monitors');
    await wizard(page).getByLabel('Add a page path').fill('/pricing');
    await wizard(page).getByRole('button', { name: 'Add page' }).click();
    await expect(wizard(page).getByRole('checkbox')).toHaveCount(2);
    await goToStep(page, 'statusPage');
    await next(page, 'Skip this step');
    await goToStep(page, 'review');

    // Fail the first monitor POST only; the list GET (with a query string) never matches.
    let failed = 0;
    await page.route('**/api/monitors', async (route) => {
      if (route.request().method() !== 'POST' || failed > 0) return route.fallback();
      failed += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Injected failure' }) });
    });

    const review = page.getByTestId('setup-review');
    await review.getByRole('button', { name: 'Create 2 items' }).click();

    const first = page.getByTestId('setup-create-item-0');
    const second = page.getByTestId('setup-create-item-1');
    await expect(first).toContainText('Failed', { timeout: 60_000 });
    await expect(first).toContainText('Injected failure');
    await expect(second).toContainText('Created', { timeout: 60_000 });
    expect(await monitorNames(page.request)).toHaveLength(1);

    await first.getByRole('button', { name: 'Retry' }).click();
    await expect(first).toContainText('Created', { timeout: 60_000 });
    await expect(first.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    expect(failed).toBe(1);

    const names = await monitorNames(page.request);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });
});
