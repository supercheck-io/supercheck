import type { APIRequestContext } from '@playwright/test';

import { expect, test } from '../../fixtures/roles.fixture';
import { requireRbacUser } from '../../utils/env';
import { waitForHydration } from '../../utils/hydration';

async function createPageWithComponent(request: APIRequestContext, name: string) {
  const page = await request.post('/api/status-pages', { data: { name } });
  expect(page.status(), await page.text()).toBe(201);
  const pageId = ((await page.json()) as { statusPage: { id: string } }).statusPage.id;
  const component = await request.post(`/api/status-pages/${pageId}/components`, { data: { name: `${name} API` } });
  expect(component.status(), await component.text()).toBe(201);
  return { id: pageId, name, componentName: `${name} API`, componentId: ((await component.json()) as { component: { id: string } }).component.id };
}

async function activeIncidents(request: APIRequestContext, pageId: string) {
  const response = await request.get(`/api/status-pages/${pageId}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { stats: { activeIncidents: number } }).stats.activeIncidents;
}

test.describe('Incident on several status pages @incidents @status-pages', () => {
  test.beforeAll(() => requireRbacUser('orgOwner'));

  test('attaches a second status page from the incident and publishes the resolution to both @critical', async ({ orgOwnerPage: page }) => {
    const request = page.request;
    const projects = await request.get('/api/projects');
    expect(projects.status()).toBe(200);
    const originalProjectId = ((await projects.json()) as { currentProject: { id: string } }).currentProject.id;
    // A fresh project: no Default policy channels and unpublished pages without subscribers, so nothing leaves the test.
    const created = await request.post('/api/projects', { data: { name: `E2E linkage ${Date.now()}`.slice(0, 40) } });
    expect(created.status(), await created.text()).toBe(201);
    const projectId = ((await created.json()) as { data: { id: string } }).data.id;
    try {
      expect((await request.post('/api/projects/switch', { data: { projectId } })).status()).toBe(200);
      const suffix = Date.now();
      const first = await createPageWithComponent(request, `E2E public ${suffix}`);
      const second = await createPageWithComponent(request, `E2E enterprise ${suffix}`);

      // Declare with a post on the first page.
      const declared = await request.post('/api/sre/incidents', {
        data: {
          title: `E2E checkout errors ${suffix}`,
          statusPage: { statusPageId: first.id, componentIds: [first.componentId], impact: 'major', message: 'Investigating checkout errors.' },
        },
      });
      expect(declared.status(), await declared.text()).toBe(201);
      const incidentId = ((await declared.json()) as { incident: { id: string } }).incident.id;
      expect((await request.post(`/api/sre/incidents/${incidentId}/acknowledge`, { data: {} })).status()).toBe(200);

      // Attach the second page from the incident's properties.
      await page.goto(`/incidents/${incidentId}`, { waitUntil: 'domcontentloaded' });
      await waitForHydration(page);
      const posts = page.getByTestId('incident-status-pages');
      await expect(posts.getByRole('link', { name: first.name })).toBeVisible();
      await posts.getByRole('button', { name: 'Post to status page' }).click();
      const dialog = page.getByRole('dialog', { name: 'New status update' });
      await dialog.getByRole('combobox', { name: 'Status page *' }).click();
      // The first page already has this incident's post, so only the second is offered.
      await expect(page.getByRole('option', { name: first.name })).toHaveCount(0);
      await page.getByRole('option', { name: second.name }).click();
      await dialog.getByLabel(second.componentName, { exact: true }).click();
      await dialog.getByLabel('Initial Message *').fill('Enterprise customers may see checkout errors.');
      await dialog.getByRole('button', { name: 'Post status update', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(posts.getByRole('link', { name: second.name })).toBeVisible();
      expect(await activeIncidents(request, first.id)).toBe(1);
      expect(await activeIncidents(request, second.id)).toBe(1);

      // Resolve with the default "publish to status pages".
      await page.getByRole('button', { name: 'Resolve incident' }).first().click();
      const resolve = page.getByRole('dialog', { name: 'Resolve incident' });
      await resolve.getByLabel('What confirmed recovery?').fill('Rolled back the payment deploy; checkout succeeds again.');
      await expect(resolve.getByLabel('Publish resolution to 2 status pages')).toBeChecked();
      await resolve.getByRole('button', { name: 'Resolve incident' }).click();
      await expect(resolve).toBeHidden();

      await expect.poll(() => activeIncidents(request, first.id)).toBe(0);
      expect(await activeIncidents(request, second.id)).toBe(0);
      const incident = await request.get(`/api/sre/incidents/${incidentId}`);
      expect(((await incident.json()) as { incident: { status: string } }).incident.status).toBe('resolved');
      await expect(posts.getByText('Resolved')).toHaveCount(2);
    } finally {
      await request.post('/api/projects/switch', { data: { projectId: originalProjectId } });
      const removed = await request.delete(`/api/projects/${projectId}`);
      if (!removed.ok() && removed.status() !== 404) throw new Error(`Project cleanup failed: ${await removed.text()}`);
    }
  });
});
