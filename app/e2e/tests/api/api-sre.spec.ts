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
});
