const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

/**
 * Optimized Playwright configuration for Supercheck execution service
 * Aligned with worker capacity limits and resource management
 */

// Construct the path relative to the current file's directory
const serviceRoot = path.resolve(__dirname);

// Use environment variables or default values - no local test directory since tests are dynamically created
const testDir = process.env.PLAYWRIGHT_TEST_DIR || '/tmp/playwright-tests';
const relativeOutputDir = 'report';

// Worker configuration aligned with execution service limits
const getOptimalWorkerCount = () => {
  // Check if we're in a resource-constrained environment
  const isCI = !!process.env.CI;
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isProduction = process.env.NODE_ENV === 'production';

  // Align with execution service maxConcurrentExecutions = 1
  if (isProduction || isCI) {
    return 1; // Conservative for production/CI to prevent resource exhaustion
  }

  // For development, allow slightly more parallelism but still conservative
  return isDevelopment ? 2 : 1;
};

console.log(`Playwright Config Loaded`);
console.log(`Service Root: ${serviceRoot}`);
console.log(`Test Directory: ${testDir}`);
console.log(`Output Directory: ${relativeOutputDir}`);
console.log(`Worker Count: ${getOptimalWorkerCount()}`);

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: testDir,

  /* Optimized parallel execution aligned with execution service */
  fullyParallel: true,

  /* Worker count optimized for resource management */
  workers: getOptimalWorkerCount(),

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Smart retry strategy */
  retries: process.env.PLAYWRIGHT_RETRIES
    ? +process.env.PLAYWRIGHT_RETRIES
    : process.env.CI
      ? 1
      : 1, // More retries in CI for flaky network conditions

  /* Reporter configuration optimized for artifact storage */
  reporter: [
    ['html'], // Always generate HTML reports for S3 upload
    ['list'], // Console output for debugging
    // Add JSON reporter for metrics if needed
    ...(process.env.ENABLE_JSON_REPORTER
      ? [['json', { outputFile: 'test-results.json' }]]
      : []),
  ],

  /* Timeouts aligned with execution service limits */
  timeout: 110000, // 110 seconds - slightly less than execution service timeout (120s) for cleanup time
  expect: {
    timeout: 15000, // 15 seconds for assertions
  },

  /* Global test setup timeout */
  globalTimeout: 600000, // 10 minutes for entire test suite (job timeout is 15min)

  /* Optimized settings for Supercheck execution environment */
  use: {
    /* Action timeout optimized for web application testing */
    actionTimeout: 20000, // 20 seconds - balanced for real-world conditions
    navigationTimeout: 30000, // 30 seconds for page loads

    /* Artifact collection strategy - configurable via environment variables */
    trace: process.env.PLAYWRIGHT_TRACE || 'retain-on-failure',
    screenshot: process.env.PLAYWRIGHT_SCREENSHOT || 'only-on-failure',
    // Video recording enabled on test failures for debugging (with increased resource limits)
    video: process.env.PLAYWRIGHT_VIDEO || 'retain-on-failure',

    /* Browser optimization for resource efficiency - browser-specific args moved to projects */

    /* Context options for better isolation and performance */
    contextOptions: {
      // Reduce memory usage
      reducedMotion: 'reduce',
      // Faster test execution
      strictSelectors: true,
    },

    /* Ignore HTTPS errors for testing flexibility */
    ignoreHTTPSErrors: true,
  },

  /* Directory for test artifacts such as screenshots, videos, traces, etc. */
  outputDir: relativeOutputDir, // Use the relative path

  /* Optimized browser projects for Supercheck execution */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Override with optimized settings
        viewport: { width: 1280, height: 720 }, // Standard viewport for consistent results
        // Enable headless mode for better performance
        headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
        // Chrome-specific launch options - optimized for containerized environments
        launchOptions: {
          args: [
            // CRITICAL: Core container compatibility flags
            '--disable-dev-shm-usage', // Prevent /dev/shm issues in containers
            '--disable-gpu', // Reduce GPU memory usage
            '--no-sandbox', // Required for containerized environments
            '--disable-setuid-sandbox',
            '--disable-web-security', // Allow cross-origin requests for testing

            // REMOVED --single-process: Causes "Target page closed" errors and browser instability
            // Let browser manage processes naturally for better stability

            // Font rendering fixes (prevents fontconfig errors)
            '--font-render-hinting=none',
            '--disable-font-subpixel-positioning',

            // Memory and resource optimization (kept minimal for stability)
            '--disable-features=TranslateUI,AudioServiceOutOfProcess',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--disable-translate',
            '--no-first-run',
            '--no-default-browser-check',

            // Additional stability flags
            '--disable-gpu-sandbox',
            '--disable-accelerated-2d-canvas',
          ],
        },
      },
    },

    // Additional browsers can be enabled via environment variables
    ...(process.env.ENABLE_FIREFOX === 'true'
      ? [
          {
            name: 'firefox',
            use: {
              ...devices['Desktop Firefox'],
              viewport: { width: 1280, height: 720 },
              headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
              // Firefox-specific launch options (minimal args)
              launchOptions: {
                args: [
                  '--no-sandbox', // Required for containerized environments
                ],
              },
            },
          },
        ]
      : []),

    ...(process.env.ENABLE_WEBKIT === 'true'
      ? [
          {
            name: 'webkit',
            use: {
              ...devices['Desktop Safari'],
              viewport: { width: 1280, height: 720 },
              headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
              // WebKit-specific launch options (very minimal - WebKit is picky)
              launchOptions: {
                args: [
                  // WebKit doesn't support most Chrome flags, keep minimal
                ],
              },
            },
          },
        ]
      : []),

    // Mobile testing projects (opt-in)
    ...(process.env.ENABLE_MOBILE === 'true'
      ? [
          {
            name: 'mobile',
            use: {
              ...devices['iPhone 13'],
              headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
            },
          },
        ]
      : []),
  ],

  /* Performance and cleanup optimizations */
  maxFailures: process.env.CI ? 5 : undefined, // Stop after 5 failures in CI

  /* Metadata for execution tracking */
  // metadata: {
  //   executionEnvironment: process.env.NODE_ENV || 'development',
  //   workerCapacity: getOptimalWorkerCount(),
  //   configVersion: '2.0.0', // Track config changes
  // },

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
