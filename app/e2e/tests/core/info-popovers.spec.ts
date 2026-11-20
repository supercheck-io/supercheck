import { expect } from '@playwright/test';
import { test } from '../../fixtures';
import { createMonitor, deleteMonitor } from '../../utils/test-data';
import { waitForHydration } from '../../utils/hydration';

// Info icons open a click-to-open popover (InfoPopover), not a hover tooltip.
test.describe('Info popovers @core', () => {
  test('the incidents list severity icon opens a popover that Escape closes @medium @positive', async ({ projectAdminPage: page }) => {
    await page.goto('/incidents');
    await waitForHydration(page);

    const trigger = page.getByRole('button', { name: 'About severity' });
    await trigger.click();
    const popover = page.getByRole('dialog', { name: 'About severity' });
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('SEV1 is a customer-facing outage');

    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
  });

  test('the alert settings incident icon opens a popover @medium @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const { id } = await createMonitor(request, {
      name: `E2E info popover ${Date.now()}`,
      enabled: false,
      alertConfig: {
        enabled: true,
        notificationProviders: [],
        alertOnFailure: true,
        alertOnRecovery: true,
        failureThreshold: 1,
        recoveryThreshold: 1,
        incidentEnabled: true,
      },
    });
    cleanup.add(`monitor ${id}`, () => deleteMonitor(request, id));

    await page.goto(`/monitors/${id}/edit`);
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Configure Alerts' }).click();

    await page.getByRole('button', { name: 'About incidents' }).click();
    const popover = page.getByRole('dialog', { name: 'About incidents' });
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('Track the problem in Incidents');

    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
  });
});
