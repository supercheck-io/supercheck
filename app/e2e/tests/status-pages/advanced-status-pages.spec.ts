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

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect.poll(async () => statusFor(request, created.id)).toBe('published');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
    await expect.poll(async () => statusFor(request, created.id)).toBe('draft');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
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
