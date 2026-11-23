import { expect, test } from '../../fixtures/roles.fixture';
import { requireRbacUser } from '../../utils/env';
import { waitForHydration } from '../../utils/hydration';

test.describe('Declare an incident @incidents', () => {
  test.beforeAll(() => {
    requireRbacUser('orgOwner');
    requireRbacUser('viewer');
  });

  test('declares from Quick Create; a viewer gets no button and a 403 @critical', async ({ orgOwnerPage: page, viewerPage }) => {
    const projects = await page.request.get('/api/projects');
    expect(projects.status()).toBe(200);
    const originalProjectId = ((await projects.json()) as { currentProject: { id: string } }).currentProject.id;
    // A fresh project has no Default policy channels, so declaring sends nothing outside the test.
    const created = await page.request.post('/api/projects', { data: { name: `E2E declare ${Date.now()}`.slice(0, 40) } });
    expect(created.status(), await created.text()).toBe(201);
    const projectId = ((await created.json()) as { data: { id: string } }).data.id;
    try {
      expect((await page.request.post('/api/projects/switch', { data: { projectId } })).status()).toBe(200);

      await page.goto('/create', { waitUntil: 'domcontentloaded' });
      await waitForHydration(page);
      await page.getByRole('heading', { name: 'Respond to an incident' }).waitFor();
      await page.getByText('Declare incident', { exact: true }).click();
      await page.waitForURL(/\/incidents\?new=1/);
      const dialog = page.getByRole('dialog', { name: 'Declare incident' });
      await expect(dialog).toBeVisible();
      const title = `E2E declared ${Date.now()}`;
      await dialog.getByLabel('Title').fill(title);
      await dialog.getByRole('button', { name: 'Declare incident' }).click();
      await page.waitForURL(/\/incidents\/[0-9a-f-]{36}$/);
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await expect(page.getByText('Incident created', { exact: false }).first()).toBeVisible();

      // Server-side denial, independent of the hidden button.
      await viewerPage.goto('/incidents', { waitUntil: 'domcontentloaded' });
      await waitForHydration(viewerPage);
      await expect(viewerPage.getByRole('heading', { name: /incidents/i }).first()).toBeVisible();
      await expect(viewerPage.getByRole('button', { name: 'Declare incident' })).toHaveCount(0);
      const denied = await viewerPage.request.post('/api/sre/incidents', { data: { title: 'Should not exist' } });
      expect(denied.status()).toBe(403);
    } finally {
      await page.request.post('/api/projects/switch', { data: { projectId: originalProjectId } });
      const removed = await page.request.delete(`/api/projects/${projectId}`);
      if (!removed.ok() && removed.status() !== 404) throw new Error(`Project cleanup failed: ${await removed.text()}`);
    }
  });
});
