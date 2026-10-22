import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { createStatusPageThroughUi } from '../../utils/status-page-test-data';

test.describe('Status page publishing and management @status-pages @high', () => {
  test('publishes and unpublishes a draft with persisted API state', async ({
    projectAdminPage,
    cleanup,
  }) => {
    const page = projectAdminPage;
    const request = projectAdminPage.request;
    const created = await createStatusPageThroughUi(page, request, cleanup);
    await page.goto(`/status-pages/${created.id}`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('tab', { name: 'Components', exact: true }).click();
    await page.getByRole('button', { name: 'Add Component', exact: true }).click();
    const componentDialog = page.getByRole('dialog', { name: 'Add Component' });
    await componentDialog.getByLabel('Name *').fill(`E2E public component ${Date.now()}`);
    await componentDialog.getByRole('button', { name: 'Add Component', exact: true }).click();
    await expect(componentDialog).toBeHidden();

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect.poll(async () => statusFor(request, created.id)).toBe('published');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect.poll(async () => statusFor(request, created.id)).toBe('published');
    await dialog.getByRole('button', { name: 'Unpublish page', exact: true }).click();
    await expect.poll(async () => statusFor(request, created.id)).toBe('draft');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
  });

  test('archives a draft only after confirmation with persisted API state', async ({
    projectAdminPage,
    cleanup,
  }) => {
    const page = projectAdminPage;
    const request = page.request;
    const created = await createStatusPageThroughUi(page, request, cleanup);
    await page.goto(`/status-pages/${created.id}`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect.poll(async () => statusFor(request, created.id)).toBe('draft');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(async () => statusFor(request, created.id)).toBe('draft');

    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await dialog.getByRole('button', { name: 'Archive page', exact: true }).click();
    await expect.poll(async () => statusFor(request, created.id)).toBe('archived');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Archive', exact: true })).not.toBeVisible();
  });

  test('exposes each management tab for the selected status page', async ({
    projectAdminPage,
    cleanup,
  }) => {
    const page = projectAdminPage;
    const request = projectAdminPage.request;
    const created = await createStatusPageThroughUi(page, request, cleanup);
    await page.goto(`/status-pages/${created.id}`, { waitUntil: 'domcontentloaded' });

    for (const name of ['Overview', 'Components', 'Incidents', 'Subscribers', 'Settings']) {
      const tab = page.getByRole('tab', { name });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toBeVisible();
    }
  });
});

async function statusFor(
  request: import('@playwright/test').APIRequestContext,
  id: string,
): Promise<string | undefined> {
  const response = await request.get('/api/status-pages', {
    params: { page: '1', limit: '100' },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: Array<{ id: string; status: string }> };
  return body.data.find((item) => item.id === id)?.status;
}
