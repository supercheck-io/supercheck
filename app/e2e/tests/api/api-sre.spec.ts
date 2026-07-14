import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('SRE API Endpoints @api @sre', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test.use({ storageState: { cookies: [], origins: [] } });

  test('Services API should require authentication', async ({ request }) => {
    const response = await request.get('/api/services');
    expect(response.ok()).toBeFalsy();
  });

  test('Incidents API should require authentication', async ({ request }) => {
    const response = await request.get('/api/incidents');
    expect(response.ok()).toBeFalsy();
  });

  test('Copilot API should require authentication', async ({ request }) => {
    const response = await request.post('/api/copilot/chat', {
      data: { message: 'Hello' }
    });
    expect(response.ok()).toBeFalsy();
  });
});
