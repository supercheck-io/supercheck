import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { waitForHydration } from '../../utils/hydration';
import { chooseProfile, expectStep, purgeCreatedItems, signUpFreshCreator, stepButton } from '../../utils/setup-test-data';

// @axe-core/playwright is not a dependency of this suite, so this covers what Playwright can
// check directly: the labelled step list, aria-current, keyboard operation, dark mode and no
// horizontal page scroll at 320px. The rail also lists the AI steps when a provider is configured,
// so the walk follows the rail itself and only requires the always-present steps.
const REQUIRED_STEPS = ['app', 'alerts', 'monitors', 'statusPage', 'review'];

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('Project setup accessibility @setup', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser, baseURL }) => {
    const creator = await signUpFreshCreator(browser, baseURL ?? '', 'a11y');
    context = creator.context;
    page = creator.page;
  });

  test.afterAll(async () => {
    // beforeAll can fail before the page exists.
    if (!page) return;
    await purgeCreatedItems(page.request);
    await context.close();
  });

  test('320px dark mode: the step rail is a labelled list, works by keyboard and the page never scrolls sideways @critical', async () => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/setup');
    await waitForHydration(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);

    await expectNoHorizontalScroll(page);
    await chooseProfile(page, 'Keep production up');
    await expectNoHorizontalScroll(page);

    const rail = page.getByRole('navigation', { name: 'Setup steps' });
    await expect(rail).toBeVisible();
    await expect(rail.locator('[aria-current="step"]')).toHaveCount(1);
    await expectStep(page, 'app');
    const steps = await rail
      .locator('[data-testid^="setup-step-"]')
      .evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace('setup-step-', '')));
    expect(steps).toEqual(expect.arrayContaining(REQUIRED_STEPS));

    // Tab walks the rail in order; Enter selects the focused step and moves aria-current.
    await stepButton(page, 'app').focus();
    for (const key of steps.slice(1)) {
      await page.keyboard.press('Tab');
      await expect(stepButton(page, key)).toBeFocused();
      await page.keyboard.press('Enter');
      await expectStep(page, key);
      await expect(rail.locator('[aria-current="step"]')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });
});
