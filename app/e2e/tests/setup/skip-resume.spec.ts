import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { waitForHydration } from '../../utils/hydration';
import {
  chooseProfile,
  expectStep,
  goToStep,
  next,
  purgeCreatedItems,
  signUpFreshCreator,
  stepButton,
  wizard,
} from '../../utils/setup-test-data';

test.describe('Project setup skip and resume @setup', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser, baseURL }) => {
    const creator = await signUpFreshCreator(browser, baseURL ?? '', 'skip');
    context = creator.context;
    page = creator.page;
  });

  test.afterAll(async () => {
    // beforeAll can fail before the page exists.
    if (!page) return;
    await purgeCreatedItems(page.request);
    await context.close();
  });

  test('skipped Alerts and Status page stay open on the checklist and the wizard resumes at the same step @critical', async () => {
    await chooseProfile(page, 'Keep production up');

    await expectStep(page, 'app');
    await next(page);
    await expectStep(page, 'alerts');
    await next(page, 'Skip this step');
    await expectStep(page, 'monitors');
    await goToStep(page, 'statusPage');
    await next(page, 'Skip this step');
    await goToStep(page, 'review');
    await expect(stepButton(page, 'alerts')).toContainText('Skipped');
    await expect(stepButton(page, 'statusPage')).toContainText('Skipped');

    // Leave through the dialog, which flushes the draft first.
    await wizard(page).getByRole('button', { name: 'Exit setup' }).click();
    await page.getByRole('dialog', { name: 'Leave setup?' }).getByRole('button', { name: 'Leave and resume later' }).click();
    await expect(page).toHaveURL(/\/$/);

    // Reload resumes at Review with both steps still marked skipped.
    await page.goto('/setup');
    await waitForHydration(page);
    await expectStep(page, 'review');
    await page.reload();
    await waitForHydration(page);
    await expectStep(page, 'review');
    await expect(stepButton(page, 'alerts')).toContainText('Skipped');
    await expect(stepButton(page, 'statusPage')).toContainText('Skipped');
    await expect(page.getByTestId('setup-review')).toContainText('Skipped: Alerts, Status page');

    // Nothing was created, so the dashboard card keeps every item open.
    await page.goto('/');
    await waitForHydration(page);
    const card = page.getByTestId('getting-started-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('link', { name: /Alert channel/ })).toContainText('(not done)');
    await expect(card.getByRole('link', { name: /Status page/ })).toContainText('(not done)');
  });
});
