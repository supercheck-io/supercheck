import { test as base } from '@playwright/test';

type SmokeFixtures = {
  smokePage: import('@playwright/test').Page;
};

export const test = base.extend<SmokeFixtures>({
  smokePage: async ({ page }, use) => {
    const errors: string[] = [];

    // Catch 5xx network responses
    page.on('response', (response) => {
      if (response.status() >= 500) {
        errors.push(`Network 5xx Error: ${response.status()} on ${response.url()}`);
      }
    });

    await use(page);

    // Fail the test if any unhandled errors were captured
    if (errors.length > 0) {
      throw new Error(`Smoke test failed with ${errors.length} errors:\n${errors.join('\n')}`);
    }
  },
});

export { expect } from '@playwright/test';
