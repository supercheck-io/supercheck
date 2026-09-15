import { expect, test } from '@playwright/test';
import { authenticateWithApi } from '../../utils/api-auth';
import { env } from '../../utils/env';

test.describe('Session invalidation @auth @security', () => {
  test('invalidates other sessions, preserves current session, then supports logout everywhere @high @security', async ({
    playwright,
    baseURL,
  }) => {
    if (!env.sessionTestUser.email || !env.sessionTestUser.password) {
      throw new Error(
        'E2E_SESSION_USER_EMAIL and E2E_SESSION_USER_PASSWORD must identify a dedicated session test user',
      );
    }
    if (!baseURL) throw new Error('Playwright baseURL is required');
    const [stateA, stateB] = await Promise.all([
      authenticateWithApi(playwright.request, baseURL, env.sessionTestUser),
      authenticateWithApi(playwright.request, baseURL, env.sessionTestUser),
    ]);
    const sessionA = await playwright.request.newContext({ baseURL, storageState: stateA });
    const sessionB = await playwright.request.newContext({ baseURL, storageState: stateB });

    try {
      const before = await sessionB.get('/api/auth/invalidate-sessions');
      expect(before.status()).toBe(200);
      const beforeBody = (await before.json()) as {
        success: boolean;
        data: { totalSessions: number; sessions: Array<{ isCurrent: boolean; token?: unknown }> };
      };
      expect(beforeBody.success).toBe(true);
      expect(beforeBody.data.totalSessions).toBeGreaterThanOrEqual(2);
      expect(beforeBody.data.sessions).toContainEqual(
        expect.objectContaining({ isCurrent: true }),
      );
      for (const session of beforeBody.data.sessions) {
        expect(session).not.toHaveProperty('token');
      }

      const preserveCurrent = await sessionB.post('/api/auth/invalidate-sessions', {
        data: { invalidateAll: false },
      });
      expect(preserveCurrent.status()).toBe(200);
      expect(await preserveCurrent.json()).toMatchObject({
        success: true,
        data: {
          invalidatedCount: expect.any(Number),
          totalSessions: expect.any(Number),
          currentSessionPreserved: true,
        },
      });

      const invalidatedSession = await sessionA.get('/api/projects');
      expect(invalidatedSession.status()).toBe(401);
      const preservedSession = await sessionB.get('/api/projects');
      expect(preservedSession.status()).toBe(200);

      const invalidateAll = await sessionB.post('/api/auth/invalidate-sessions', {
        data: { invalidateAll: true },
      });
      expect(invalidateAll.status()).toBe(200);
      expect(await invalidateAll.json()).toMatchObject({
        success: true,
        data: { currentSessionPreserved: false },
      });

      const afterLogoutEverywhere = await sessionB.get('/api/projects');
      expect(afterLogoutEverywhere.status()).toBe(401);
    } finally {
      await sessionA.dispose();
      await sessionB.dispose();
    }
  });

  test('session-management API rejects unauthenticated callers @high @security', async ({
    playwright,
    baseURL,
  }) => {
    const unauthenticated = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      for (const method of ['get', 'post'] as const) {
        const response = await unauthenticated[method]('/api/auth/invalidate-sessions', {
          data: method === 'post' ? { invalidateAll: true } : undefined,
        });
        expect(response.status()).toBe(401);
        expect(await response.json()).toEqual({ error: 'Authentication required' });
      }
    } finally {
      await unauthenticated.dispose();
    }
  });
});
