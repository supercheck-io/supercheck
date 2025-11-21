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
const defaultOutputDir = path.resolve(serviceRoot, 'playwright-report');
const artifactOutputDir =
  process.env.PLAYWRIGHT_OUTPUT_DIR || defaultOutputDir;
const htmlReportDir =
  process.env.PLAYWRIGHT_HTML_REPORT ||
  path.join(artifactOutputDir, 'html');
const jsonOutputFile =
  process.env.PLAYWRIGHT_JSON_OUTPUT ||
  path.join(artifactOutputDir, 'results.json');

// Worker configuration aligned with execution service limits
const getOptimalWorkerCount = () => {
  // Allow override via environment variable
  if (process.env.PLAYWRIGHT_WORKERS) {
    return parseInt(process.env.PLAYWRIGHT_WORKERS, 10);
  }

  // Check if we're in a resource-constrained environment
  const isCI = !!process.env.CI;
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isProduction = process.env.NODE_ENV === 'production';

  // Use 2 workers for better performance
  // Container has 2GB RAM and 2 CPUs - can handle 2 parallel browser instances
  if (isProduction || isCI) {
    return 2; // Optimized for container resources (2 CPUs, 2GB RAM)
  }

  // For development, allow slightly more parallelism
  return isDevelopment ? 2 : 1;
};

console.log(`Playwright Config Loaded`);
console.log(`Service Root: ${serviceRoot}`);
console.log(`Test Directory: ${testDir}`);
console.log(`Output Directory: ${artifactOutputDir}`);
console.log(`JSON Output File: ${jsonOutputFile}`);
console.log(`HTML Report Directory: ${htmlReportDir}`);
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
    [
      'html',
      {
        outputFolder: htmlReportDir,
        open: 'never',
      },
    ], // Always generate HTML reports for S3 upload
    ['list'], // Console output for debugging
    [
      'json',
      {
        // Use env var for dynamic output path set per execution
        outputFile: jsonOutputFile,
      },
    ], 
  ],

  /* Timeouts aligned with execution service limits */
  // Increased to handle slower browser operations and network requests
  timeout: 240000, // 4 minutes per test - well below 5min execution timeout
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
    // Capture traces on failure for debugging
    trace: process.env.PLAYWRIGHT_TRACE || 'retain-on-failure',
    // Capture screenshots only on failure to avoid performance degradation
    // Full screenshots for all tests can be enabled via PLAYWRIGHT_SCREENSHOT='all'
    screenshot: process.env.PLAYWRIGHT_SCREENSHOT || 'on',
    // Video recording for failed tests for debugging (with increased resource limits)
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
  outputDir: artifactOutputDir, // Container passes /tmp path; fallback keeps local dev under repo

  /* Optimized browser projects for Supercheck execution */
  projects: [
    {
      name: 'chromium',
      // Ignore mobile, firefox, and webkit tests to avoid duplicate execution
      grepInvert: /@mobile|@iPhone|@firefox|@webkit|@safari/,
      use: {
        ...devices['Desktop Chrome'],
        // Override with optimized settings
        viewport: { width: 1280, height: 720 }, // Standard viewport for consistent results
        // Enable headless mode for better performance
        headless: true,
        // Chrome-specific launch options - optimized for containerized environments
        launchOptions: {
          args: [
            // CRITICAL: Core container compatibility flags
            // '--disable-dev-shm-usage', // Prevent /dev/shm issues in containers (Causes WebKit failure in mixed mode)
            // '--disable-gpu', // Reduce GPU memory usage
            // '--no-sandbox', // Required for containerized environments
            // '--disable-setuid-sandbox',
            // '--disable-web-security', // Allow cross-origin requests for testing

            // REMOVED --single-process: Causes "Target page closed" errors and browser instability
            // Let browser manage processes naturally for better stability

            // Font rendering fixes (prevents fontconfig errors)
            // '--font-render-hinting=none',
            // '--disable-font-subpixel-positioning',

            // Memory and resource optimization (kept minimal for stability)
            // '--disable-features=TranslateUI,AudioServiceOutOfProcess',
            // '--disable-background-networking',
            // '--disable-default-apps',
            // '--disable-extensions',
            // '--disable-sync',
            // '--disable-translate',
            // '--no-first-run',
            // '--no-default-browser-check',

            // Additional stability flags
            // '--disable-gpu-sandbox',
            // '--disable-accelerated-2d-canvas',
            // '--disable-dev-shm-usage', // Re-enable for Chromium only if needed, but safe to omit if stable
          ],
        },
      },
    },

    // Additional browsers can be enabled via environment variables
    // Additional browsers
    {
      name: 'firefox',
      grep: /@firefox/,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
        headless: true,
        // Firefox-specific launch options (minimal args)
        launchOptions: {
          args: [
            '--no-sandbox', // Required for containerized environments
          ],
        },
      },
    },

    {
      name: 'webkit',
      grep: /@webkit|@safari/,
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 },
        headless: true,
        // WebKit-specific launch options (very minimal - WebKit is picky)
        launchOptions: {
          args: [
            // WebKit doesn't support most Chrome flags, keep minimal
          ],
        },
      },
    },

    // Mobile testing projects (opt-in via @mobile tag)
    {
      name: 'mobile-safari',
      // Only run tests tagged with @mobile
      grep: /@mobile|@iPhone/,
      use: {
        ...devices['iPhone 16'],
        headless: true,
      },
    },
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
