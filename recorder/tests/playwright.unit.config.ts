import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './unit',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'line',
});
