import { expect } from '@playwright/test';
import { test } from '../../fixtures';
import { createMonitor, deleteMonitor } from '../../utils/test-data';
import { waitForHydration } from '../../utils/hydration';

// Info icons open a click-to-open popover (InfoPopover), not a hover tooltip.
test.describe('Info popovers @core', () => {
  test('the incidents list severity icon opens a popover that Escape closes @medium @positive', async ({ orgOwnerPage: page }) => {
    // The table (and its header icon) needs at least one incident, and the icon is hidden below the sm breakpoint.
    // Incidents cannot be deleted, so the test uses its own project and deletes that afterwards.
    await page.setViewportSize({ width: 1440, height: 900 });
    const projects = await page.request.get('/api/projects');
    expect(projects.ok(), await projects.text()).toBe(true);
    const originalProjectId = ((await projects.json()) as { currentProject: { id: string } }).currentProject.id;
    const created = await page.request.post('/api/projects', { data: { name: `E2E info popover ${Date.now()}` } });
    expect(created.status(), await created.text()).toBe(201);
    const projectId = ((await created.json()) as { data: { id: string } }).data.id;
    try {
      expect((await page.request.post('/api/projects/switch', { data: { projectId } })).status()).toBe(200);
      const incident = await page.request.post('/api/sre/incidents', { data: { title: `E2E info popover ${Date.now()}`, severity: 'sev4' } });
      expect(incident.status(), await incident.text()).toBe(201);

      await page.goto('/incidents');
      await waitForHydration(page);

      await page.getByRole('button', { name: 'About severity' }).click();
      const popover = page.getByRole('dialog', { name: 'About severity' });
      await expect(popover).toBeVisible();
      await expect(popover).toContainText('SEV1 is a customer-facing outage');

      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
    } finally {
      await page.request.post('/api/projects/switch', { data: { projectId: originalProjectId } });
      const removed = await page.request.delete(`/api/projects/${projectId}`);
      if (!removed.ok() && removed.status() !== 404) throw new Error(`Project cleanup failed: ${await removed.text()}`);
    }
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
