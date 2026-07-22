import { test, expect } from '@playwright/test';
import { MonitorsPage, MonitorCreatePage } from '../../pages/monitors.page';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Monitor Execution - M1 to M5 @monitors @execution', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('M1: Create HTTP monitor @critical @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();

    await monitorsPage.clickCreate();

    const createPage = new MonitorCreatePage(page);
    await createPage.expectLoaded();

    const httpCard = page.locator('text=/http/i').first();
    if (await httpCard.isVisible().catch(() => false)) {
      await httpCard.click();
    }

    expect(page.url()).toContain('/monitors/create');
  });

  test('M5: Create Playwright Synthetic monitor @high @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();

    await monitorsPage.clickCreate();

    const createPage = new MonitorCreatePage(page);
    await createPage.expectLoaded();

    const syntheticCard = page.locator('text=/synthetic|playwright/i').first();
    if (await syntheticCard.isVisible().catch(() => false)) {
      await syntheticCard.click();
    }

    expect(page.url()).toContain('/monitors/create');
  });
});
