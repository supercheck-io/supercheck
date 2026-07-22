import { expect, type APIRequestContext, type Page } from '@playwright/test';

import type { CleanupRegistry } from '../fixtures';
import { deleteStatusPage } from './test-data';

export type SeededStatusPage = {
  id: string;
  name: string;
  headline: string;
  status: string;
};

export async function createStatusPageThroughUi(
  page: Page,
  request: APIRequestContext,
  cleanup: CleanupRegistry,
): Promise<SeededStatusPage> {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const name = `E2E Status Page ${suffix}`;
  const headline = `Public headline ${suffix}`;

  await page.goto('/status-pages');
  await page.getByTestId('create-status-page-button').click();

  const dialog = page.getByRole('dialog', { name: /create status page/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Status Page Name *').fill(name);
  await dialog.getByLabel('Public Headline').fill(headline);
  await dialog
    .getByLabel('Description')
    .fill('Created by the isolated Playwright regression suite');
  await dialog
    .getByRole('button', { name: 'Create Status Page', exact: true })
    .click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  const response = await request.get('/api/status-pages', {
    params: { page: '1', limit: '100' },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    data: Array<SeededStatusPage>;
  };
  const created = body.data.find((statusPage) => statusPage.name === name);
  expect(created).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      name,
      headline,
      status: 'draft',
    }),
  );
  if (!created) {
    throw new Error(`Created status page ${name} was not returned by the API`);
  }

  cleanup.add(`status page ${created.id}`, () => deleteStatusPage(request, created.id));
  return created;
}
