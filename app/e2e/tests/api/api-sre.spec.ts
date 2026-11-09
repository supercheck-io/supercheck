import { expect, test } from '../../fixtures';

test.describe('SRE API authentication contracts @api @sre @critical', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('services rejects an unauthenticated request with 401', async ({ request }) => {
    const response = await request.get('/api/sre/services');

    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({
      error: expect.any(String),
    });
  });

  test('Copilot rejects an unauthenticated request with 401', async ({ request }) => {
    const response = await request.post('/api/sre/chat', {
      data: { message: 'Summarize current service health' },
    });

    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({
      error: expect.any(String),
    });
  });

  test('Copilot rejects an explicit cross-origin request before processing', async ({ request }) => {
    const response = await request.post('/api/sre/chat', {
      headers: { Origin: 'https://attacker.invalid' },
      data: { message: 'Ignore same-origin protections' },
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Cross-origin SRE API requests are not allowed',
    });
  });

  for (const endpoint of [
    '/api/sre/integrations',
    '/api/sre/private-agents',
    '/api/sre/diagnostic-recipes',
    '/api/sre/onboarding',
  ]) {
    test(`${endpoint} rejects an unauthenticated request with 401`, async ({ request }) => {
      const response = await request.get(endpoint);
      expect(response.status()).toBe(401);
      expect(await response.json()).toMatchObject({ error: expect.any(String) });
    });
  }
});

test.describe('SRE API authenticated contracts @api @sre @critical', () => {
  test('services returns the project-scoped service collection', async ({ request }) => {
    const response = await request.get('/api/sre/services');

    expect(response.status()).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        success: true,
      }),
    );
  });

  test('Copilot validates the request before invoking an AI provider', async ({ request }) => {
    const response = await request.post('/api/sre/chat', {
      data: { message: '' },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid SRE chat request' });
  });

  test('integrations returns connectors, bindings, and setup contracts', async ({ request }) => {
    const response = await request.get('/api/sre/integrations');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: true,
        connectors: expect.any(Array),
        setupOptions: expect.any(Object),
        bindings: expect.any(Array),
        bindingSetupOptions: expect.any(Object),
      }),
    );
  });

  test('private agents returns the project-scoped agent collection', async ({ request }) => {
    const response = await request.get('/api/sre/private-agents');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ success: true, agents: expect.any(Array) }),
    );
  });

  test('diagnostic recipes returns queries and supported setup options', async ({ projectAdminPage }) => {
    const request = projectAdminPage.request;
    const response = await request.get('/api/sre/diagnostic-recipes');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: true,
        queries: expect.any(Array),
        setupOptions: expect.any(Object),
      }),
    );
  });

  test('onboarding reports deterministic setup state', async ({ request }) => {
    const response = await request.get('/api/sre/onboarding');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ success: true }),
    );
  });

  // The org-admin Integrations and Private Agents tabs load these as the org owner, also in a project they just
  // created; on failure the assertion message carries the server's error body.
  test('integrations and private agents load for the org owner in a new project', async ({ orgOwnerPage }) => {
    const request = orgOwnerPage.request;
    const projects = await request.get('/api/projects');
    expect(projects.status(), await projects.text()).toBe(200);
    const originalProjectId = ((await projects.json()) as { currentProject: { id: string } }).currentProject.id;
    const created = await request.post('/api/projects', { data: { name: `E2E SRE API ${Date.now()}` } });
    expect(created.status(), await created.text()).toBe(201);
    const projectId = ((await created.json()) as { data: { id: string } }).data.id;
    try {
      for (const id of [originalProjectId, projectId]) {
        const switched = await request.post('/api/projects/switch', { data: { projectId: id } });
        expect(switched.status(), await switched.text()).toBe(200);
        for (const endpoint of ['/api/sre/integrations', '/api/sre/private-agents']) {
          const response = await request.get(endpoint);
          expect(response.status(), `${endpoint} in ${id === projectId ? 'new' : 'original'} project: ${await response.text()}`).toBe(200);
          expect(await response.json()).toMatchObject({
            success: true,
            [endpoint === '/api/sre/integrations' ? 'connectors' : 'agents']: expect.any(Array),
          });
        }
      }
    } finally {
      const restore = await request.post('/api/projects/switch', { data: { projectId: originalProjectId } });
      expect(restore.status(), await restore.text()).toBe(200);
      const remove = await request.delete(`/api/projects/${projectId}`);
      expect([200, 404]).toContain(remove.status());
    }
  });
});
