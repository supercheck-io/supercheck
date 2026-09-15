import { expect } from '@playwright/test';

import { test } from '../../fixtures';

type Requirement = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  coverageStatus: string;
};

test.describe('Requirements lifecycle @requirements @critical', () => {
  test('creates, updates, reads, and deletes a requirement through the UI', async ({
    projectAdminPage,
  }) => {
    const page = projectAdminPage;
    const request = projectAdminPage.request;
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const title = `E2E Requirement ${suffix}`;
    const updatedTitle = `${title} updated`;
    let requirementId: string | undefined;
    let deleted = false;

    try {
      await page.goto('/requirements/new', { waitUntil: 'load' });
      await page.getByLabel('Title').fill(title);
      await page.getByLabel('Description').fill('Original E2E requirement description');
      await page.getByRole('button', { name: 'Create Requirement', exact: true }).click();
      await expect(page).toHaveURL(/\/requirements(?:\?|$)/);

      const created = await findRequirement(request, title);
      expect(created).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title,
          description: 'Original E2E requirement description',
          priority: expect.any(String),
          coverageStatus: expect.any(String),
        }),
      );
      if (!created) throw new Error(`Requirement ${title} was not persisted`);
      requirementId = created.id;

      await openRequirementFromList(page, title);
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/requirements/edit/${requirementId}$`));
      await page.getByLabel('Title').fill(updatedTitle);
      await page.getByLabel('Description').fill('Updated E2E requirement description');
      await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
      await expect(page).toHaveURL(/\/requirements(?:\?|$)/);

      await expect.poll(async () => findRequirement(request, updatedTitle)).toEqual(
        expect.objectContaining({
          id: requirementId,
          title: updatedTitle,
          description: 'Updated E2E requirement description',
        }),
      );

      await deleteRequirementThroughUi(page, requirementId);
      deleted = true;
      await expect.poll(async () => findRequirement(request, updatedTitle)).toBeUndefined();
    } finally {
      if (requirementId && !deleted) {
        await deleteRequirementThroughUi(page, requirementId);
      }
    }
  });
});

test.describe('Requirements authorization @requirements @security @critical', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('rejects unauthenticated requirement reads', async ({ request }) => {
    const response = await request.get('/api/requirements');
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });
});

async function findRequirement(
  request: import('@playwright/test').APIRequestContext,
  title: string,
): Promise<Requirement | undefined> {
  const response = await request.get('/api/requirements', {
    params: { search: title, page: '1', pageSize: '100' },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: Requirement[] };
  return body.data.find((requirement) => requirement.title === title);
}

async function deleteRequirementThroughUi(
  page: import('@playwright/test').Page,
  id: string,
): Promise<void> {
  await page.goto('/requirements', { waitUntil: 'load' });
  const response = await page.request.get('/api/requirements', {
    params: { page: '1', pageSize: '100' },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: Array<{ id: string; title: string }> };
  const requirement = body.data.find((item) => item.id === id);
  if (!requirement) return;

  const filter = page.getByPlaceholder('Filter by all available fields...');
  await filter.fill(requirement.title);
  const row = page.getByRole('row').filter({ hasText: requirement.title });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete Requirement?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/requirements(?:\?|$)/);
}

async function openRequirementFromList(
  page: import('@playwright/test').Page,
  title: string,
): Promise<void> {
  await page.goto('/requirements', { waitUntil: 'load' });
  const filter = page.getByPlaceholder('Filter by all available fields...');
  await filter.fill(title);
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}
