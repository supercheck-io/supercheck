import { expect, test } from '@playwright/test';

test.describe('Health, CLI and automation API contracts @api @critical', () => {
  test('deep health endpoint reports required dependency health', async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        status: expect.stringMatching(/^(ok|degraded)$/),
        timestamp: expect.any(String),
        latencyMs: expect.any(Number),
        checks: expect.objectContaining({
          database: expect.objectContaining({ status: 'ok' }),
        }),
      }),
    );
  });

  test('CLI project config rejects an unauthenticated request', async ({ playwright }) => {
    const unauthenticated = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });

    try {
      const response = await unauthenticated.get('/api/cli/project-config');
      expect(response.status()).toBe(401);
      expect(await response.json()).toMatchObject({ error: expect.any(String) });
    } finally {
      await unauthenticated.dispose();
    }
  });

  test('CLI token listing returns redacted token metadata', async ({ request }) => {
    const response = await request.get('/api/cli-tokens');

    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      tokens: Array<Record<string, unknown>>;
    };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.tokens)).toBe(true);

    for (const token of body.tokens) {
      expect(token).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          enabled: expect.any(Boolean),
          start: expect.any(String),
        }),
      );
      expect(token).not.toHaveProperty('key');
    }
  });

  test('CLI token creation validates input without mutating data', async ({ request }) => {
    const response = await request.post('/api/cli-tokens', {
      data: { name: '   ', expiresIn: 60 },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: 'Validation failed',
        details: expect.arrayContaining([
          expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
        ]),
      }),
    );
  });
});
