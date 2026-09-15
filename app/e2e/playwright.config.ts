import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * Playwright E2E Test Configuration for Supercheck
 *
 * Authentication approach: Each test file that needs authentication
 * uses a setup project to create a shared authenticated storage state.
 */
export default defineConfig({
  testDir: './tests',

  /* The suite mutates a shared demo account, so files must not overlap freely. */
  fullyParallel: false,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Flakes are failures: CI must prove every test passes on its first attempt. */
  retries: 0,

  /* CI uses one shared account; parallel workers cause state and rate-limit collisions. */
  workers: process.env.CI ? 1 : 2,

  /* Reporter to use */
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
    ...(process.env.E2E_FAIL_ON_PRIORITY_SKIPS === 'true'
      ? [['./reporters/priority-skip-reporter.ts'] as [string]]
      : []),
  ],

  /* Shared settings for all the projects below */
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://demo.supercheck.dev',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15000,
    navigationTimeout: 45000,
  },

  /* Allow production pages enough time when the full suite is running. */
  timeout: 60000,

  /* Expect timeout */
  expect: {
    timeout: 10000,
  },

  /* Configure projects */
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'user-auth-state.json',
      },
      dependencies: ['setup'],
    },
  ],

  /* Output directory for test artifacts */
  outputDir: 'test-results',
});
