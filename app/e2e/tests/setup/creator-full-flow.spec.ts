import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { waitForHydration } from '../../utils/hydration';
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

// The wizard order for "Keep production up": App, Alerts, Monitors, (AI SRE), Status page, (Requirements and tests), Review and create.
test.describe('Project setup creator flow @setup', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser, baseURL }) => {
    const creator = await signUpFreshCreator(browser, baseURL ?? '', 'creator');
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

  test('persona, app URL, email channel, monitors and status page create, then the dashboard card ticks @critical', async () => {
    await expect(page).toHaveURL(/\/setup/);
    await chooseProfile(page, 'Keep production up');

    await expectStep(page, 'app');
    await wizard(page).getByLabel('App URL').fill('https://example.com');
    await next(page);

    // Email is the default channel form, pre-filled with the signed-in address.
    await expectStep(page, 'alerts');
    const emailButton = wizard(page).getByRole('button', { name: /^Email/ });
    await expect(emailButton).toBeVisible();
    if ((await emailButton.getAttribute('aria-pressed')) !== 'true') await emailButton.click();
    const emailForm = page.getByTestId('setup-channel-form-email');
    await expect(emailForm).toBeVisible();
    await emailForm.getByRole('button', { name: 'Save channel' }).click();
    await expect(wizard(page).getByText('Already set up')).toBeVisible();
    await next(page);

    // The homepage monitor starts ticked.
    await expectStep(page, 'monitors');
    await expect(wizard(page).getByRole('checkbox').first()).toBeChecked();
    await goToStep(page, 'statusPage');
    await goToStep(page, 'review');
    const review = page.getByTestId('setup-review');
    await expect(review).toContainText('Already saved');
    // Website monitor, status page and its component.
    await expect(page.getByTestId('setup-create-item-0')).toContainText('example.com');
    const create = review.getByRole('button', { name: /^Create \d+ items?$/ });
    await create.click();

    for (const index of [0, 1, 2]) {
      await expect(page.getByTestId(`setup-create-item-${index}`)).toContainText('Created', { timeout: 60_000 });
    }

    // Created items tick the dashboard card while setup is still open.
    await page.goto('/');
    await waitForHydration(page);
    const card = page.getByTestId('getting-started-card');
    await expect(card).toBeVisible();
    for (const title of ['Uptime and SSL monitors', 'Alert channel', 'Status page']) {
      await expect(card.getByRole('link', { name: new RegExp(title) })).toContainText('(done)');
    }

    // Running Create again adopts every item instead of duplicating it; then finishing hides the card.
    await page.goto('/setup');
    await waitForHydration(page);
    await expectStep(page, 'review');
    await page.getByTestId('setup-review').getByRole('button', { name: /^Create \d+ items?$/ }).click();
    for (const index of [0, 1, 2]) {
      await expect(page.getByTestId(`setup-create-item-${index}`)).toContainText('Already there', { timeout: 60_000 });
    }
    expect(await monitorNames(page.request)).toHaveLength(1);
    await page.getByTestId('setup-review').getByRole('button', { name: 'Finish setup' }).click();
    await expect(page.getByText('Setup is finished.')).toBeVisible();
    await page.goto('/');
    await waitForHydration(page);
    await expect(page.getByTestId('getting-started-card')).toHaveCount(0);
  });
});
