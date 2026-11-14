import { expect, test } from '../../fixtures';
import { waitForHydration } from '../../utils/hydration';

test.describe('Incident policy: repeat and escalation @incidents @alerts', () => {
  test('org owner sets reminders and an escalation; an impossible schedule blocks Save @critical', async ({ orgOwnerPage: page, cleanup }) => {
    const name = `E2E policy ${Date.now()}`.slice(0, 20);
    const create = await page.request.post('/api/projects', { data: { name, description: 'E2E incident policy' } });
    expect(create.status(), await create.text()).toBe(201);
    const project = ((await create.json()) as { data: { id: string } }).data;
    cleanup.add(`project ${project.id}`, async () => {
      const response = await page.request.delete(`/api/projects/${project.id}`);
      if (!response.ok() && response.status() !== 404) throw new Error(`Project cleanup failed: ${await response.text()}`);
    });

    const openPolicy = async () => {
      await page.goto('/org-admin', { waitUntil: 'domcontentloaded' });
      await waitForHydration(page);
      await page.getByPlaceholder('Search projects...').fill(name);
      const row = page.getByRole('row').filter({ hasText: name });
      await row.getByRole('button', { name: /^Open actions for/ }).click();
      await page.getByRole('menuitem', { name: 'Incident notifications' }).click();
      const dialog = page.getByRole('dialog', { name: 'Incident notifications' });
      await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();
      return dialog;
    };

    const dialog = await openPolicy();
    await dialog.getByLabel('Remind if nobody acknowledges').click();
    await dialog.getByLabel('First after').fill('15');
    await dialog.getByLabel('Repeat the reminder').click();
    // 15 + 3 x 1440 minutes cannot finish inside 2 days.
    await dialog.getByLabel('Then every').fill('1440');
    await dialog.getByLabel('at most', { exact: true }).fill('4');
    await expect(dialog.getByText('Reminders must finish within 2 days', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await dialog.getByLabel('Then every').fill('60');
    await dialog.getByLabel('at most', { exact: true }).fill('3');

    await dialog.getByLabel('Escalate if still unacknowledged').click();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await dialog.getByLabel('After', { exact: true }).fill('30');
    await dialog.getByTestId('policy-escalate-target').click();
    await page.getByRole('option').and(page.locator(':not([data-disabled])')).filter({ hasNotText: 'Paged by' }).last().click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    const reopened = await openPolicy();
    await expect(reopened.getByLabel('First after')).toHaveValue('15');
    await expect(reopened.getByLabel('Then every')).toHaveValue('60');
    await expect(reopened.getByLabel('at most', { exact: true })).toHaveValue('3');
    await expect(reopened.getByLabel('After', { exact: true })).toHaveValue('30');
    await expect(reopened.getByTestId('policy-escalate-target')).not.toContainText('Choose a channel or a member');
  });
});
