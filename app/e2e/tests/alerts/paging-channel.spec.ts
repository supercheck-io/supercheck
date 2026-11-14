import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures';
import { waitForHydration } from '../../utils/hydration';

type Provider = { id: string; name: string };

/**
 * The test page is sent server-side to the vendor, which a browser test cannot reach or fake. The receiver is mocked
 * at the app's test route, so this covers the user flow; the route's own send, RBAC and redaction have unit tests.
 */
async function mockTestRoute(page: Page, reply: Record<string, unknown>) {
  await page.route('**/api/notification-providers/*/test', async (route) => {
    const action = (route.request().postDataJSON() as { action?: string } | null)?.action ?? 'trigger';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action, dedupKey: 'test:mock', ...reply }) });
  });
}

test.describe('Paging channels @alerts @channels', () => {
  test('creates a PagerDuty channel from the primary list and sends a test page @critical @positive', async ({ projectAdminPage: page, cleanup }) => {
    const name = `E2E PagerDuty ${Date.now()}`;
    cleanup.add(`paging channel ${name}`, async () => {
      const list = await page.request.get('/api/notification-providers');
      const created = ((await list.json()) as Provider[]).find((provider) => provider.name === name);
      if (created) await page.request.delete(`/api/notification-providers/${created.id}`);
    });

    await page.goto('/notifications');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Create channel' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('channel-type-select').click();
    await expect(page.getByRole('option', { name: /Opsgenie.*Ends April 5, 2027/ })).toBeVisible();
    await page.getByRole('option', { name: 'PagerDuty', exact: true }).click();
    await expect(dialog.getByTestId('one-way-paging-note')).toContainText('does not change the Supercheck incident');
    await dialog.getByLabel('Title', { exact: true }).fill(name);
    await expect(dialog.getByLabel('URL', { exact: true })).toHaveValue('https://events.pagerduty.com/v2/enqueue');
    await dialog.getByRole('button', { name: /^(Create|Save)/ }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('PagerDuty');

    await mockTestRoute(page, { ok: true, responseStatus: 202, responseStatusText: 'Accepted', responseExcerpt: '{"status":"success"}', elapsedMs: 80 });
    await row.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: 'Send test page' }).click();
    const testDialog = page.getByTestId('channel-test-dialog');
    // Nothing is sent until the user confirms in the dialog.
    await testDialog.getByTestId('channel-test-send').click();
    await expect(testDialog).toContainText('HTTP 202 Accepted');
    await expect(testDialog.getByTestId('channel-test-status')).toHaveText('Delivered');
    await testDialog.getByRole('button', { name: 'Resolve test page' }).click();
    await expect(testDialog.getByTestId('channel-test-status')).toHaveText('Resolved');
    await testDialog.getByRole('button', { name: 'Close' }).first().click();
  });

  test('shows the integration key hint when the vendor rejects the key @high @negative', async ({ projectAdminPage: page, cleanup }) => {
    const name = `E2E PD bad key ${Date.now()}`;
    const create = await page.request.post('/api/notification-providers', {
      data: { type: 'webhook', config: { name, url: 'https://events.pagerduty.com/v2/enqueue', preset: 'pagerduty', method: 'POST' } },
    });
    expect(create.status(), await create.text()).toBe(201);
    const created = (await create.json()) as Provider;
    cleanup.add(`paging channel ${created.id}`, async () => {
      await page.request.delete(`/api/notification-providers/${created.id}`);
    });

    await mockTestRoute(page, { ok: false, responseStatus: 401, responseStatusText: 'Unauthorized', error: 'Authentication rejected (HTTP 401). Check the integration key.' });
    await page.goto('/notifications');
    await waitForHydration(page);
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: 'Send test page' }).click();
    const testDialog = page.getByTestId('channel-test-dialog');
    // Nothing is sent until the user confirms in the dialog.
    await testDialog.getByTestId('channel-test-send').click();
    await expect(testDialog.getByTestId('channel-test-status')).toHaveText('Failed');
    await expect(testDialog.getByTestId('channel-test-error')).toContainText('Check the integration key');
    // Resolve stays available: the test page always uses the same dedup key.
    await expect(testDialog.getByRole('button', { name: 'Resolve test page' })).toBeEnabled();
  });
});
