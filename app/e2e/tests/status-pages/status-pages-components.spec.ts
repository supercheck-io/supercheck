import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { createStatusPageThroughUi } from '../../utils/status-page-test-data';

test.describe('Status-page component lifecycle @status-pages @components', () => {
  test('creates, edits, persists, and deletes the exact component @high @positive', async ({
    projectAdminPage,
    cleanup,
  }) => {
    const page = projectAdminPage;
    const request = projectAdminPage.request;
    const statusPage = await createStatusPageThroughUi(page, request, cleanup);
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const originalName = `E2E component ${suffix}`;
    const updatedName = `E2E component updated ${suffix}`;

    await page.goto(`/status-pages/${statusPage.id}`);
    await page.getByRole('tab', { name: 'Components', exact: true }).click();
    await page.getByRole('button', { name: 'Add Component', exact: true }).click();

    const createDialog = page.getByRole('dialog', { name: 'Add Component' });
    await createDialog.getByLabel('Name *').fill(originalName);
    await createDialog.getByLabel('Description').fill('Original component description');
    await createDialog.getByRole('button', { name: 'Add Component', exact: true }).click();
    await expect(createDialog).toBeHidden();

    const row = page.getByRole('row').filter({ hasText: originalName });
    await expect(row).toContainText('Operational');
    await expect(row).toContainText('Original component description');
    await row.getByTitle('Edit component').click();

    const editDialog = page.getByRole('dialog', { name: 'Edit Component' });
    await editDialog.getByLabel('Name *').fill(updatedName);
    await editDialog.getByLabel('Description').fill('Persisted component description');
    await editDialog.getByRole('button', { name: 'Update Component', exact: true }).click();
    await expect(editDialog).toBeHidden();

    const updatedRow = page.getByRole('row').filter({ hasText: updatedName });
    await expect(updatedRow).toContainText('Persisted component description');
    await page.reload();
    await page.getByRole('tab', { name: 'Components', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: updatedName })).toContainText(
      'Persisted component description',
    );

    await page.getByRole('row').filter({ hasText: updatedName }).getByTitle('Delete component').click();
    const deleteDialog = page.getByRole('alertdialog', { name: 'Delete Component' });
    await expect(deleteDialog).toContainText(updatedName);
    await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(deleteDialog).toBeHidden();
    await expect(page.getByText(updatedName, { exact: true })).toHaveCount(0);

    await page.reload();
    await page.getByRole('tab', { name: 'Components', exact: true }).click();
    await expect(page.getByText(updatedName, { exact: true })).toHaveCount(0);
  });
});
