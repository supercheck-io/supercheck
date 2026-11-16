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
      // DIAG (temporary): which side stalls the Quick Create navigation.
      page.on('request', (r) => { if (/incidents|_rsc/.test(r.url())) console.log('DIAG req', r.method(), new URL(r.url()).pathname + new URL(r.url()).search.replace(/_rsc=[^&]+/, '_rsc')); });
      page.on('response', (r) => { if (/incidents|_rsc/.test(r.url())) console.log('DIAG res', r.status(), new URL(r.url()).pathname); });
      page.on('requestfailed', (r) => console.log('DIAG failed', new URL(r.url()).pathname, r.failure()?.errorText));
      page.on('pageerror', (e) => console.log('DIAG pageerror', e.message.slice(0, 300)));
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('DIAG console', m.type(), m.text().slice(0, 300)); });
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('DIAG nav', new URL(f.url()).pathname + new URL(f.url()).search); });
      await page.getByText('Declare incident', { exact: true }).click();
      const t0 = Date.now();
      console.log('DIAG clicked');
      await page.waitForURL(/\/incidents\?new=1/).then(() => console.log('DIAG waitForURL ok', Date.now() - t0), (e) => { console.log('DIAG waitForURL timeout, url', new URL(page.url()).pathname); throw e; });
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
      await expect(viewerPage.getByRole('button', { name: 'New incident' })).toHaveCount(0);
      const denied = await viewerPage.request.post('/api/sre/incidents', { data: { title: 'Should not exist' } });
      expect(denied.status()).toBe(403);
    } finally {
      await page.request.post('/api/projects/switch', { data: { projectId: originalProjectId } });
      const removed = await page.request.delete(`/api/projects/${projectId}`);
      if (!removed.ok() && removed.status() !== 404) throw new Error(`Project cleanup failed: ${await removed.text()}`);
    }
  });
});
