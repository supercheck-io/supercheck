import { test, expect } from '../../fixtures/smoke.fixture';

test.describe('Section 0: SRE Smoke Suite @smoke @sre', () => {
  const routes = [
    '/',
    '/tests',
    '/monitors',
    '/jobs',
    '/alerts',
  ];

  for (const route of routes) {
    test(`Smoke test route: ${route}`, async ({ smokePage }) => {
      // The smokePage fixture automatically asserts no 500s or console.errors occur
      const response = await smokePage.goto(route);
      
      // Ensure the page actually returned a 200 response (not a 404 or 500)
      expect(response?.status()).toBe(200);
      
      // Wait for React to finish hydrating
      await smokePage.waitForLoadState('load');
      
      // Basic sanity check that some body content rendered
      expect(await smokePage.locator('body').count()).toBeGreaterThan(0);
    });
  }
});
