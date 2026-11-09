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
    // Traces capture raw request and response bodies, including sign-in
    // credentials. Browser tests authenticate with real accounts and CI
    // artifacts on this public repository are world-readable, so traces must
    // stay off. Failure screenshots and error context still document failures.
    trace: 'off',
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
      // The PR screenshot tour runs only against its own throwaway app.
      testIgnore: /tests\/screenshots\//,
      use: {
        ...devices['Desktop Chrome'],
        // 1.64 forwards screen from device descriptors; pinned for parity, revisit deliberately.
        screen: undefined,
        storageState: 'user-auth-state.json',
      },
      dependencies: ['setup'],
    },
    /* PR screenshot tour (pr-screenshots.yml): only with E2E_SCREENSHOTS=1, so full-suite runs never sign up on a real deployment. */
    ...(process.env.E2E_SCREENSHOTS === '1' ? [
      {
        name: 'screenshots-setup',
        testMatch: /tests\/screenshots\/screenshots\.setup\.ts$/,
        use: { ...devices['Desktop Chrome'], screen: undefined, viewport: { width: 1440, height: 900 } },
      },
      {
        name: 'screenshots',
        testMatch: /tests\/screenshots\/[^/]+\.spec\.ts$/,
        use: {
          ...devices['Desktop Chrome'],
          screen: undefined,
          viewport: { width: 1440, height: 900 },
          storageState: 'screenshots-auth-state.json',
          // Failure screenshots would land in the gallery as test-failed-1.png.
          screenshot: 'off' as const,
        },
        dependencies: ['screenshots-setup'],
      },
    ] : []),
  ],

  /* Output directory for test artifacts */
  outputDir: 'test-results',
});
