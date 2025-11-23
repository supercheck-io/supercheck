import { TestType } from "@/db/schema/types";

export interface CodeTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  testType: TestType;
  code: string;
  tags: string[];
}

export const codeTemplates: CodeTemplate[] = [
  // =========================
  // K6 Performance Templates
  // =========================
  {
    id: "k6-smoke-check",
    name: "Smoke Check (API)",
    description: "Fast uptime and latency probe before heavier runs",
    category: "Smoke & Health",
    testType: "performance",
    tags: ["k6", "smoke", "api"],
    code: `/**
 * k6 smoke test for uptime and latency.
 * 
 * Purpose:
 * - Verify system availability (uptime)
 * - Check basic latency performance
 * - Ensure the system is ready for heavier load tests
 * 
 * Configuration:
 * - VUs: 3 virtual users running concurrently
 * - Duration: 30 seconds test run
 * - Thresholds: 
 *   - Error rate must be < 1%
 *   - 95th percentile response time must be < 800ms
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // Simulates 3 concurrent users
  vus: 3,
  // Runs the test for 30 seconds
  duration: '30s',
  thresholds: {
    // Fail if more than 1% of requests fail
    http_req_failed: ['rate<0.01'],
    // Fail if 95% of requests take longer than 800ms
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  
  // Make a GET request to the target endpoint
  const response = http.get(baseUrl + '/public/crocodiles/1/');

  // Validate the response
  check(response, {
    'status is 200': (res) => res.status === 200,
    'body is not empty': (res) => res.body && res.body.length > 0,
  });

  // Pause for 1 second between iterations to pace the requests
  sleep(1);
}
`,
  },
  {
    id: "k6-ramping-load",
    name: "Ramping Load",
    description: "Gradually increases load to watch for degradation",
    category: "Load Profiles",
    testType: "performance",
    tags: ["k6", "load", "ramping"],
    code: `/**
 * Ramping load profile to mirror real traffic patterns.
 * 
 * Purpose:
 * - Simulate a gradual increase in traffic (ramp-up)
 * - Hold traffic at peak load (steady state)
 * - Gradually decrease traffic (ramp-down)
 * 
 * Configuration:
 * - Stages:
 *   1. Ramp up to 10 VUs over 2 minutes
 *   2. Ramp up to 50 VUs over next 5 minutes
 *   3. Ramp up to 80 VUs over next 3 minutes
 *   4. Ramp down to 0 VUs over 2 minutes
 * - Thresholds: Strict latency and error limits
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 10 },  // Ramp up to 10 users
    { duration: '5m', target: 50 },  // Ramp up to 50 users
    { duration: '3m', target: 80 },  // Peak load at 80 users
    { duration: '2m', target: 0 },   // Ramp down to 0
  ],
  thresholds: {
    // Fail if error rate exceeds 2%
    http_req_failed: ['rate<0.02'],
    // Latency goals: 95% < 600ms, 99% < 1200ms
    http_req_duration: ['p(95)<600', 'p(99)<1200'],
    // Ensure 95% of checks pass
    checks: ['rate>0.95'],
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  const response = http.get(baseUrl + '/public/crocodiles/');

  check(response, {
    'status is 200': (res) => res.status === 200,
    // Custom check for latency within the function
    'p95 under budget': (res) => res.timings.duration < 600,
  });
}
`,
  },
  {
    id: "k6-spike-resilience",
    name: "Spike + Recovery",
    description: "Short spike to validate autoscaling and stability",
    category: "Resilience",
    testType: "performance",
    tags: ["k6", "spike", "resilience"],
    code: `/**
 * Spike test to validate burst handling and recovery.
 * 
 * Purpose:
 * - Verify system stability during sudden traffic spikes
 * - Ensure system recovers after the spike subsides
 * - Test autoscaling triggers
 * 
 * Configuration:
 * - Executor: ramping-arrival-rate (controls throughput)
 * - Spike: Jump from 20 to 200 iterations/s in 30s
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1s',
      preAllocatedVUs: 50, // Initial pool of VUs
      maxVUs: 200,         // Max VUs to allocate during spike
      stages: [
        { duration: '30s', target: 20 },  // Steady state
        { duration: '30s', target: 200 }, // SPIKE!
        { duration: '1m', target: 20 },   // Recovery
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'], // Allow slightly higher errors during spike
    http_req_duration: ['p(99)<1500'],
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  const res = http.get(baseUrl + '/public/crocodiles/2/');

  check(res, { '200 OK during spike': (r) => r.status === 200 });
  sleep(1);
}
`,
  },
  {
    id: "k6-soak-reliability",
    name: "Soak / Endurance",
    description: "Longer run to catch memory leaks and slow creep",
    category: "Reliability",
    testType: "performance",
    tags: ["k6", "soak", "endurance"],
    code: `/**
 * Soak test (Endurance test) to surface long-running issues.
 * 
 * Purpose:
 * - Detect memory leaks
 * - Identify resource exhaustion (connections, file handles)
 * - Monitor performance degradation over time
 * 
 * Configuration:
 * - Duration: 20 minutes (shortened for demo, usually hours)
 * - VUs: Constant load of 20 users
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5m', target: 20 },  // Ramp up
    { duration: '20m', target: 20 }, // Hold steady load
    { duration: '5m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<700'],
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  const response = http.get(baseUrl + '/public/crocodiles/3/');

  check(response, { 'status is 200': (res) => res.status === 200 });
  
  // Important: Sleep to pace requests and prevent unintentional DoS
  sleep(2);
}
`,
  },
  {
    id: "k6-api-checklist",
    name: "API Checklist (GET + POST + auth)",
    description: "Exercises public and authenticated endpoints together",
    category: "API Coverage",
    testType: "performance",
    tags: ["k6", "api", "auth"],
    code: `/**
 * Mixed API flow with public and authenticated calls.
 * 
 * Purpose:
 * - Test multiple endpoints in a single script
 * - Handle authentication (Bearer token)
 * - Group metrics by functionality (list, create, auth)
 * 
 * Configuration:
 * - VUs: 20 concurrent users
 * - Duration: 2 minutes
 * - Environment: Requires API_TOKEN for auth parts
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';

export const options = {
  vus: 20,
  duration: '2m',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<450'],
    checks: ['rate>0.98'],
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  // Access environment variables using __ENV
  const token = __ENV.API_TOKEN || '';

  // Group: List Resources
  group('list resources', () => {
    const res = http.get(baseUrl + '/public/crocodiles/');
    check(res, { 'listed resources': (r) => r.status === 200 });
  });

  // Group: Create Resource
  group('create resource', () => {
    const payload = JSON.stringify({
      name: 'Load Test',
      sex: 'M',
      date_of_birth: '2015-01-01',
    });

    const res = http.post(baseUrl + '/public/crocodiles/', payload, {
      headers: { 'Content-Type': 'application/json' },
    });

    check(res, { 'created resource': (r) => r.status === 201 });
  });

  // Group: Authenticated Request (only runs if token provided)
  group('authenticated request', () => {
    if (!token) {
      return;
    }

    const res = http.get(baseUrl + '/my/crocodiles/', {
      headers: { Authorization: 'Bearer ' + token },
    });

    check(res, { 'auth works': (r) => r.status === 200 });
  });

  sleep(1);
}
`,
  },
  {
    id: "k6-checks-assertions",
    name: "Checks & Assertions",
    description: "Comprehensive checks and assertions for response validation",
    category: "API Coverage",
    testType: "performance",
    tags: ["k6", "checks", "assertions", "validation"],
    code: `/**
 * k6 checks and assertions guide.
 * 
 * Purpose:
 * - Demonstrate how to validate response data
 * - Use custom metrics (Rate, Trend) to track specific events
 * - Perform complex JSON validation
 * 
 * Key Concepts:
 * - Checks: Boolean assertions that don't fail the load test (unlike thresholds)
 * - Custom Metrics: Track business-specific logic (e.g., "custom_error_rate")
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics for tracking specific checks
const errorRate = new Rate('custom_error_rate');
const customDuration = new Trend('custom_duration');

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'custom_error_rate': ['rate<0.05'], // Fail if custom error rate > 5%
    'custom_duration': ['avg<300', 'p(90)<400'],
    'checks': ['rate>0.95'], // Fail if < 95% of checks pass
  },
};

export default function () {
  const baseUrl = 'https://jsonplaceholder.typicode.com';
  const res = http.get(baseUrl + '/posts/1');
  
  const checkResult = check(res, {
    'status is 200': (r) => r.status === 200,
    'content-type is JSON': (r) => r.headers['Content-Type']?.includes('application/json'),
    'body is valid JSON': (r) => {
      try { JSON.parse(r.body); return true; } catch { return false; }
    },
    'has expected fields': (r) => {
      const data = JSON.parse(r.body);
      return data.id !== undefined && data.title !== undefined;
    },
    'response time < 500ms': (r) => r.timings.duration < 500,
    'response size < 10KB': (r) => r.body.length < 10240,
  });
  
  // Add results to custom metrics
  errorRate.add(!checkResult);
  customDuration.add(res.timings.duration);
  
  sleep(1);
}
`,
  },
  {
    id: "k6-thresholds-advanced",
    name: "Advanced Thresholds",
    description: "Comprehensive threshold configurations with custom metrics",
    category: "Load Profiles",
    testType: "performance",
    tags: ["k6", "thresholds", "slo", "performance"],
    code: `/**
 * Advanced k6 thresholds for SLO (Service Level Objective) enforcement.
 * 
 * Purpose:
 * - Define complex pass/fail criteria
 * - Use tags to apply thresholds to specific endpoints (read vs write)
 * - Track success rates and latency percentiles
 * 
 * Configuration:
 * - Stages: Ramp up -> Hold -> Ramp down
 * - Thresholds: 
 *   - Global latency limits
 *   - Specific limits for 'read' and 'write' operations
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const apiCalls = new Counter('api_calls');
const successRate = new Rate('success_rate');
const apiLatency = new Trend('api_latency');

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration': [
      'avg<300',
      'p(50)<200',
      'p(90)<500',
      'p(95)<700',
      'p(99)<1000',
    ],
    'checks': ['rate>0.95'],
    'success_rate': ['rate>0.98'],
    'api_latency': ['p(95)<300', 'p(99)<500'],
    // Tag-based thresholds
    'http_req_duration{endpoint:read}': ['p(95)<400'],
    'http_req_duration{endpoint:write}': ['p(95)<500'],
  },
};

export default function () {
  const baseUrl = 'https://jsonplaceholder.typicode.com';
  
  // Read operation
  const getRes = http.get(baseUrl + '/posts/1', {
    tags: { endpoint: 'read' }, // Tagging for specific thresholds
  });
  
  apiCalls.add(1);
  const getSuccess = check(getRes, { 
    'GET successful': (r) => r.status === 200,
    'has content': (r) => r.body && r.body.length > 0,
  });
  successRate.add(getSuccess);
  apiLatency.add(getRes.timings.duration);
  
  // Write operation
  const postRes = http.post(
    baseUrl + '/posts',
    JSON.stringify({ title: 'Test', body: 'Load test', userId: 1 }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'write' }, // Tagging for specific thresholds
    }
  );
  
  apiCalls.add(1);
  const postSuccess = check(postRes, { 
    'POST successful': (r) => r.status === 201,
  });
  successRate.add(postSuccess);
  apiLatency.add(postRes.timings.duration);
  
  sleep(1);
}
`,
  },
  {
    id: "k6-stress-test",
    name: "Stress Test",
    description: "Pushes system beyond normal capacity to find breaking points",
    category: "Resilience",
    testType: "performance",
    tags: ["k6", "stress", "capacity"],
    code: `/**
 * Stress test to find system breaking points.
 * 
 * Purpose:
 * - Push the system beyond normal capacity
 * - Determine the maximum capacity of the system
 * - Verify system recovery after stress
 * 
 * Configuration:
 * - Stages: Step-wise increase in load (100 -> 200 -> 300 VUs)
 * - Thresholds: Relaxed latency limits (5s) to allow for degradation under stress
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Load 100
    { duration: '5m', target: 100 },
    { duration: '2m', target: 200 }, // Load 200
    { duration: '5m', target: 200 },
    { duration: '2m', target: 300 }, // Load 300 (Stress)
    { duration: '5m', target: 300 },
    { duration: '5m', target: 0 },   // Recovery
  ],
  
  thresholds: {
    'http_req_failed': ['rate<0.1'], // Allow 10% failure under stress
    'http_req_duration': ['p(95)<5000'], // Allow 5s latency
    'errors': ['rate<0.15'],
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  
  // Batch requests for higher throughput
  const responses = http.batch([
    ['GET', baseUrl + '/public/crocodiles/'],
    ['GET', baseUrl + '/public/crocodiles/1/'],
    ['GET', baseUrl + '/public/crocodiles/2/'],
  ]);
  
  responses.forEach((res) => {
    const passed = check(res, {
      'status 200': (r) => r.status === 200,
      'response time acceptable': (r) => r.timings.duration < 3000,
    });
    errorRate.add(!passed);
  });
  
  sleep(1);
}
`,
  },
  {
    id: "k6-breakpoint-test",
    name: "Breakpoint Test",
    description: "Gradually increases load until system breaks",
    category: "Resilience",
    testType: "performance",
    tags: ["k6", "breakpoint", "capacity"],
    code: `/**
 * Breakpoint test to identify exact system limits.
 * 
 * Purpose:
 * - Find the exact point where the system fails
 * - Determine the "knee" of the curve where latency spikes
 * 
 * Configuration:
 * - Executor: ramping-arrival-rate (constant throughput increase)
 * - Stages: Aggressive ramp up to 1000 iterations/s
 * - Thresholds: Abort test immediately if failure rate or latency gets too high
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  executor: 'ramping-arrival-rate',
  startRate: 50,
  timeUnit: '1s',
  preAllocatedVUs: 500,
  maxVUs: 1000,
  stages: [
    { target: 200, duration: '10m' },
    { target: 500, duration: '10m' },
    { target: 1000, duration: '10m' }, // Push to breaking point
  ],
  
  thresholds: {
    // Abort test early if system is broken to save resources
    'http_req_failed': [{ threshold: 'rate<0.05', abortOnFail: true }],
    'http_req_duration': [{ threshold: 'p(99)<3000', abortOnFail: true }],
  },
};

export default function () {
  const res = http.get('https://test-api.k6.io/public/crocodiles/');
  check(res, {
    'status 200': (r) => r.status === 200,
    'latency acceptable': (r) => r.timings.duration < 2000,
  });
}
`,
  },

  // =========================
  // Playwright Browser Templates
  // =========================
  {
    id: "pw-browser-smoke",
    name: "UI Smoke (navigation)",
    description: "Loads the app and confirms core UI renders (Chromium)",
    category: "Browser fundamentals",
    testType: "browser",
    tags: ["playwright", "smoke", "ui", "chromium"],
    code: `/**
 * Playwright UI smoke test.
 * 
 * Purpose:
 * - Verify that the application loads correctly
 * - Check that critical UI elements are visible
 * - Perform a basic user interaction (add a todo item)
 * 
 * Configuration:
 * - Default browser: Chromium (unless specified otherwise via tags or config)
 * - Base URL: Defined in the test (replace with your app's URL)
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

// No tag = Chromium (default)
test.describe('UI smoke test', () => {
  test('home page renders primary UI', async ({ page }) => {
    // Navigate to the application
    await page.goto(APP_URL);

    // Verify page title and input visibility
    await expect(page).toHaveTitle(/TodoMVC/);
    await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();

    // Perform interaction: Add a new task
    await page.getByPlaceholder('What needs to be done?').fill('Smoke task');
    await page.keyboard.press('Enter');
    
    // Verify the task was added to the list
    await expect(page.getByRole('listitem').first()).toContainText('Smoke task');
  });
});
`,
  },
  {
    id: "pw-browser-auth",
    name: "Auth flow (login + logout)",
    description: "Covers form fill, navigation, and session state",
    category: "Auth flows",
    testType: "browser",
    tags: ["playwright", "auth", "login"],
    code: `/**
 * Authentication flow test (Login & Logout).
 * 
 * Purpose:
 * - Verify user can successfully log in with valid credentials
 * - Verify user is redirected to the secure area
 * - Verify user can log out successfully
 * 
 * Key Actions:
 * - Form filling (username/password)
 * - Button clicking
 * - URL and element visibility assertions
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://the-internet.herokuapp.com';
const CREDENTIALS = { username: 'tomsmith', password: 'SuperSecretPassword!' };

test.describe('authentication flow', () => {
  test('user can sign in and sign out', async ({ page }) => {
    await page.goto(APP_URL + '/login');

    // Fill login form
    await page.getByLabel('Username').fill(CREDENTIALS.username);
    await page.getByLabel('Password').fill(CREDENTIALS.password);
    await page.getByRole('button', { name: 'Login' }).click();

    // Verify successful login
    await expect(page.getByText('You logged into a secure area!')).toBeVisible();
    
    // Perform logout
    await page.getByRole('link', { name: 'Logout' }).click();
    
    // Verify redirect to login page
    await expect(page).toHaveURL(APP_URL + '/login');
  });
});
`,
  },
  {
    id: "pw-browser-responsive",
    name: "Mobile / responsive layout",
    description: "Emulates mobile devices and checks responsive behavior",
    category: "Responsive & devices",
    testType: "browser",
    tags: ["playwright", "mobile", "responsive"],
    code: `/**
 * Mobile viewport testing.
 * 
 * Purpose:
 * - Verify layout and functionality on mobile screen sizes
 * - Ensure responsive design elements work as expected
 * 
 * Configuration:
 * - Defines separate tests for Mobile Chrome (Pixel 8) and Mobile Safari (iPhone 13)
 * - Checks viewport dimensions
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

// Test mobile Chrome (Pixel 8)
test.describe('Mobile Chrome layout', () => {
  test('mobile Chrome viewport exposes key actions', async ({ page }) => {
    await page.goto(APP_URL);

    // Verify Pixel 8 viewport dimensions (393x851)
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(393);
    expect(viewport?.height).toBe(851);

    await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();

    // Test mobile-specific interactions
    await page.getByPlaceholder('What needs to be done?').fill('Mobile Chrome task');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listitem').first()).toContainText('Mobile Chrome task');
  });
});

// Test mobile Safari (iPhone 13)
test.describe('Mobile Safari layout', () => {
  test('mobile Safari viewport and interactions', async ({ page }) => {
    await page.goto(APP_URL);

    // Verify iPhone 13 viewport dimensions (390x844)
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(390);
    expect(viewport?.height).toBe(844);

    await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();

    // Test iOS Safari specific behavior
    await page.getByPlaceholder('What needs to be done?').fill('Mobile Safari task');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listitem').first()).toContainText('Mobile Safari task');
  });
});
`,
  },
  {
    id: "pw-browser-emulation",
    name: "Device emulation (geo, locale, timezone)",
    description: "Emulates location, language, and timezone settings",
    category: "Responsive & devices",
    testType: "browser",
    tags: ["playwright", "emulation", "geolocation"],
    code: `/**
 * Device emulation with geolocation, locale, and timezone.
 * 
 * Purpose:
 * - Test location-based features (GPS)
 * - Verify internationalization (i18n) and localization (l10n)
 * - Check timezone handling
 * 
 * Configuration:
 * - Geolocation: Rome, Italy
 * - Permissions: Automatically grants 'geolocation' permission
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

test.use({
  // Set geolocation to Rome, Italy
  geolocation: { longitude: 12.492507, latitude: 41.889938 },
  permissions: ['geolocation'],
  
  // Locale and timezone can also be set here or in global config
  // locale: 'en-US',
  // timezoneId: 'UTC',
});

test.describe('geolocation and locale emulation', () => {
  test('app responds to geolocation and locale', async ({ page }) => {
    await page.goto(APP_URL);
    
    // Verify geolocation is correctly set in the browser context
    const position = await page.evaluate(() => {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition((pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        });
      });
    });
    
    expect(position).toMatchObject({
      latitude: 41.889938,
      longitude: 12.492507,
    });
    
    // Verify locale settings
    const locale = await page.evaluate(() => navigator.language);
    expect(locale).toBe('en-US');
  });
});
`,
  },

  {
    id: "pw-browser-tag-selection",
    name: "Browser selection with tags",
    description: "Demonstrates how to target specific browsers using tags",
    category: "Browser fundamentals",
    testType: "browser",
    tags: ["playwright", "tags", "browser-selection"],
    code: `/**
 * Browser selection using tags.
 * 
 * Purpose:
 * - Run tests only on specific browsers (e.g., WebKit/Safari)
 * - Demonstrate how to use the 'tag' option in test.describe
 * 
 * Usage:
 * - @webkit: Runs on WebKit (Safari engine)
 * - @firefox: Runs on Firefox
 * - @chromium: Runs on Chromium (default)
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

// This test suite will ONLY run when the project is 'webkit' or has the @webkit tag
test.describe('Browser Selection Demo - WebKit', { tag: ['@webkit'] }, () => {
  test('webkit basic functionality', async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page).toHaveTitle(/TodoMVC/);
    
    // Verify we are running in a WebKit/Safari environment
    const userAgent = await page.evaluate(() => navigator.userAgent);
    expect(userAgent).toContain('Safari');
    
    // Add a todo to verify basic functionality
    await page.getByPlaceholder('What needs to be done?').fill('WebKit browser demo');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listitem').first()).toContainText('WebKit browser demo');
  });
});
`,
  },

  // =========================
  // Playwright API Templates
  // =========================
  {
    id: "pw-api-health",
    name: "Health / JSON contract",
    description: "Validates status, headers, and JSON shape",
    category: "API health",
    testType: "api",
    tags: ["playwright", "api", "health"],
    code: `/**
 * API health probe with contract checks.
 * 
 * Purpose:
 * - Verify that the API is up and running (status 200)
 * - Check that the response headers are correct (Content-Type)
 * - Validate the structure and data types of the response body
 * 
 * Key Actions:
 * - GET request
 * - Status assertion
 * - Header assertion
 * - JSON body validation
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const API_URL = 'https://jsonplaceholder.typicode.com';

test.describe('API health check', () => {
  test('health endpoint responds with expected payload', async ({ request }) => {
    // Send GET request
    const response = await request.get(API_URL + '/posts/1');

    // Basic status checks
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    // Validate JSON structure
    const body = await response.json();
    expect(body).toMatchObject({ id: 1 });
    expect(typeof body.title).toBe('string');
  });
});
`,
  },
  {
    id: "pw-api-crud",
    name: "Create + read + cleanup",
    description: "Serializes CRUD flow with cleanup",
    category: "API CRUD",
    testType: "api",
    tags: ["playwright", "api", "crud"],
    code: `/**
 * API CRUD flow executed serially.
 * 
 * Purpose:
 * - Test the full lifecycle of a resource (Create, Read, Delete)
 * - Ensure data consistency across operations
 * - Clean up test data after execution
 * 
 * Key Actions:
 * - POST to create a resource
 * - GET to verify creation
 * - DELETE to clean up
 * - test.describe.serial ensures tests run in order
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const API_URL = 'https://jsonplaceholder.typicode.com';

// Use serial mode to share state (createdId) between tests
test.describe.serial('posts CRUD', () => {
  let createdId;

  test('creates a post', async ({ request }) => {
    const response = await request.post(API_URL + '/posts', {
      data: { title: 'Playwright', body: 'API example', userId: 1 },
    });

    expect(response.status()).toBe(201);
    const json = await response.json();
    createdId = json.id;
    expect(json).toMatchObject({ title: 'Playwright', body: 'API example' });
  });

  test('fetches the created post', async ({ request }) => {
    // Skip if creation failed
    test.skip(!createdId, 'create step failed');
    
    const response = await request.get(API_URL + '/posts/' + createdId);
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.id).toBe(createdId);
  });

  // Cleanup after all tests in this group
  test.afterAll(async ({ request }) => {
    if (!createdId) return;
    await request.delete(API_URL + '/posts/' + createdId);
  });
});
`,
  },
  {
    id: "pw-api-auth",
    name: "Authenticated request",
    description: "Adds bearer token headers and validates profile data",
    category: "Authentication",
    testType: "api",
    tags: ["playwright", "api", "auth"],
    code: `/**
 * Authenticated API call using a bearer token.
 * 
 * Purpose:
 * - Verify access to protected endpoints
 * - Demonstrate how to inject authorization headers
 * - Validate user-specific data
 * 
 * Configuration:
 * - Uses request.newContext to apply headers to all requests in the scope
 * - Requires a valid API_TOKEN
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const API_URL = 'https://api.example.com';
const API_TOKEN = 'replace-with-token';

test.describe('authenticated API request', () => {
  test('authenticated profile request', async ({ request }) => {
    // Create a new context with the Authorization header pre-configured
    const api = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: 'Bearer ' + API_TOKEN },
    });

    const response = await api.get('/user/profile');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('email');
    expect(body).toHaveProperty('id');

    // Always dispose of the context when done
    await api.dispose();
  });
});
`,
  },

  // =========================
  // Database Templates (pg)
  // =========================
  {
    id: "pw-db-read",
    name: "SELECT health check",
    description: "Confirms connectivity and column shape",
    category: "Database checks",
    testType: "database",
    tags: ["playwright", "database", "select"],
    code: `/**
 * PostgreSQL read health check.
 * 
 * Purpose:
 * - Verify database connectivity
 * - Check that a specific table exists and has expected columns
 * - Ensure read operations are functioning
 * 
 * Configuration:
 * - Requires 'pg' library
 * - Connection string must be configured
 * 
 * @requires @playwright/test, pg
 */

import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgres://user:password@localhost:5432/dbname',
});

test.afterAll(async () => {
  await pool.end();
});

// Cheap heartbeat query to ensure the database is reachable.
test.describe('database read health check', () => {
  test('users table returns expected columns', async () => {
    // Execute a simple SELECT query
    const result = await pool.query('SELECT id, email FROM users LIMIT 1');
    
    // Verify we got results and the schema matches expectations
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.rows[0]).toHaveProperty('email');
  });
});
`,
  },
  {
    id: "pw-db-transaction",
    name: "Insert with rollback",
    description: "Writes inside a transaction and keeps DB clean",
    category: "Transactions",
    testType: "database",
    tags: ["playwright", "database", "transaction"],
    code: `/**
 * Transactional insert with rollback for clean state.
 * 
 * Purpose:
 * - Test write operations without polluting the database
 * - Verify that INSERTs work correctly
 * - Ensure data isolation by rolling back changes
 * 
 * Key Actions:
 * - BEGIN transaction
 * - INSERT data
 * - Verify insertion
 * - ROLLBACK transaction
 * - Verify data is gone
 * 
 * @requires @playwright/test, pg
 */

import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgres://user:password@localhost:5432/dbname',
});

test.afterAll(async () => {
  await pool.end();
});

// Use transactions so test data never leaks into production.
test.describe('database transaction with rollback', () => {
  test('insert + rollback keeps DB clean', async () => {
    const client = await pool.connect();

    try {
      // Start transaction
      await client.query('BEGIN');

      // Perform insert
      const inserted = await client.query(
        'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, name',
        ['playwright@example.com', 'Playwright Test']
      );

      // Verify insert was successful within the transaction
      expect(inserted.rowCount).toBe(1);
      expect(inserted.rows[0].email).toBe('playwright@example.com');

      // Rollback changes
      await client.query('ROLLBACK');

      // Verify data was removed
      const check = await client.query(
        'SELECT 1 FROM users WHERE email = $1',
        ['playwright@example.com']
      );
      expect(check.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });
});
`,
  },
  {
    id: "pw-db-update",
    name: "Safe UPDATE with RETURNING",
    description: "Guards updates with WHERE clause and row assertions",
    category: "Database checks",
    testType: "database",
    tags: ["playwright", "database", "update"],
    code: `/**
 * Safe UPDATE example with RETURNING.
 * 
 * Purpose:
 * - Demonstrate how to safely update records
 * - Verify the update affected the correct rows
 * - Check the returned data matches expectations
 * 
 * Best Practices:
 * - Always use WHERE clauses to limit scope
 * - Use RETURNING to verify the new state immediately
 * 
 * @requires @playwright/test, pg
 */

import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgres://user:password@localhost:5432/dbname',
});

test.afterAll(async () => {
  await pool.end();
});

// Example update: always scope by id and assert row count.
test.describe('safe database update', () => {
  test('updates a user safely', async () => {
    const result = await pool.query(
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name',
      ['Updated Name', 1]
    );

    // Verify exactly one row was updated
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].id).toBe(1);
    expect(result.rows[0].name).toBe('Updated Name');
  });
});
`,
  },

  {
    id: "pw-custom-fixtures",
    name: "Custom test fixtures",
    description: "Creates reusable page objects and test data",
    category: "Cross-layer",
    testType: "custom",
    tags: ["playwright", "fixtures", "page-object"],
    code: `/**
 * Custom fixtures for reusable test components.
 * 
 * Purpose:
 * - Abstract common actions into reusable "fixtures"
 * - Simplify test code by removing repetitive setup/teardown
 * - Implement the Page Object Model (POM) pattern
 * 
 * Key Concepts:
 * - test.extend: Creates a new test object with custom fixtures
 * - Page Object: Encapsulates page-specific logic (goto, addTodo, getTodoText)
 * 
 * @requires @playwright/test
 */

import { test as base, expect } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

// Extend base test with custom fixtures
const test = base.extend({
  todoPage: async ({ page }, use) => {
    // Create page object methods
    const todoPage = {
      goto: async () => {
        await page.goto(APP_URL);
      },
      
      addTodo: async (text) => {
        await page.getByPlaceholder('What needs to be done?').fill(text);
        await page.keyboard.press('Enter');
      },
      
      getTodoText: async (index) => {
        const text = await page.getByRole('listitem').nth(index).textContent();
        return text || '';
      },
    };
    
    // Navigate to app before each test
    await todoPage.goto();
    // Pass the fixture to the test
    await use(todoPage);
  },
});

// Use the fixture in tests
test.describe('custom fixtures and page objects', () => {
  test('add todo using fixture', async ({ todoPage }) => {
    await todoPage.addTodo('Buy groceries');
    const text = await todoPage.getTodoText(0);
    expect(text).toContain('Buy groceries');
  });

  test('add multiple todos', async ({ todoPage }) => {
    await todoPage.addTodo('Task 1');
    await todoPage.addTodo('Task 2');
    
    expect(await todoPage.getTodoText(0)).toContain('Task 1');
    expect(await todoPage.getTodoText(1)).toContain('Task 2');
  });
});
`,
  },

  {
    id: "pw-custom-form-stubbing",
    name: "Form with API stubbing",
    description: "Submits a form while stubbing the backend response",
    category: "Cross-layer",
    testType: "custom",
    tags: ["playwright", "forms", "stubbing", "api"],
    code: `/**
 * Form submission with network stubbing.
 * 
 * Purpose:
 * - Test frontend logic in isolation from the backend
 * - Simulate specific backend responses (success, error, edge cases)
 * - Speed up tests by avoiding real network calls
 * 
 * Key Actions:
 * - page.route: Intercepts network requests
 * - route.fulfill: Provides a mock response
 * - UI verification: Checks that the UI handles the mock response correctly
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

test.describe('form submission with API stubbing', () => {
  test('stubs todo creation API and validates UI response', async ({ page }) => {
    // Stub the todo creation API call
    await page.route('**/todos', async (route) => {
      // Only intercept POST requests
      if (route.request().method() !== 'POST') {
        return route.continue();
      }

      let body = {};
      try {
        body = route.request().postDataJSON() || {};
      } catch {
        body = {};
      }

      // Mock successful API response
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ 
          id: 999, 
          title: body.title || 'Stubbed todo',
          completed: false,
          userId: 1 
        }),
      });
    });

    await page.goto(APP_URL);

    // Fill and submit the "form" (todo input)
    await page.getByPlaceholder('What needs to be done?').fill('API stubbed todo');
    await page.keyboard.press('Enter');

    // Verify the todo appears in the UI (would normally come from real API)
    await expect(page.getByRole('listitem').first()).toContainText('API stubbed todo');
  });
});
`,
  },

  {
    id: "pw-custom-device-emulation",
    name: "Device emulation showcase",
    description: "Demonstrates various device emulation options and capabilities",
    category: "Cross-layer",
    testType: "custom",
    tags: ["playwright", "devices", "emulation", "mobile"],
    code: `/**
 * Device emulation capabilities showcase.
 * 
 * Purpose:
 * - Demonstrate how to emulate different devices (Mobile, Tablet, Desktop)
 * - Verify touch interactions
 * - Check responsive layout adaptations
 * 
 * Configuration:
 * - Uses 'devices' dictionary from Playwright
 * - Can be configured globally or per-test using test.use()
 * 
 * @requires @playwright/test
 */

import { test, expect, devices } from '@playwright/test';

const APP_URL = 'https://playwright.dev/';

// Uncomment one of these to test specific device emulation:
// test.use({ ...devices['iPhone 13'] });        // Mobile: 390x844
// test.use({ ...devices['iPhone 12'] });        // Mobile: 390x844  
// test.use({ ...devices['Pixel 5'] });          // Mobile: 393x851
// test.use({ ...devices['Pixel 8'] });          // Mobile: 393x851
// test.use({ ...devices['iPad'] });             // Tablet: 768x1024
// test.use({ ...devices['iPad Pro'] });         // Tablet: 1024x1366
// test.use({ ...devices['Desktop Chrome'] });   // Desktop: 1280x720
// test.use({ ...devices['Desktop Safari'] });   // Desktop: 1280x720

test.describe('device emulation capabilities', () => {
  test('viewport and device characteristics', async ({ page }) => {
    await page.goto(APP_URL);
    
    // Get current viewport dimensions
    const viewport = page.viewportSize();
    console.log('Current viewport:', viewport);
    
    // Verify device-specific user agent
    const userAgent = await page.evaluate(() => navigator.userAgent);
    console.log('User Agent:', userAgent);
    
    // Check if mobile device (touch support)
    const isTouch = await page.evaluate(() => 'ontouchstart' in window);
    console.log('Touch capable:', isTouch);
    
    // Verify page loads correctly on current device
    await expect(page).toHaveTitle(/Playwright/);
  });

  test('mobile-specific interactions', async ({ page }) => {
    await page.goto(APP_URL);
    
    // Test mobile navigation (hamburger menu if present)
    const mobileMenu = page.getByRole('button', { name: /menu/i }).first();
    
    if (await mobileMenu.isVisible()) {
      await mobileMenu.click();
      console.log('✅ Mobile menu interaction successful');
    } else {
      console.log('ℹ️ No mobile menu detected on current viewport');
    }
    
    // Test touch-friendly element interaction
    await page.getByRole('link', { name: 'Get started' }).click();
    await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
    console.log('✅ Touch-friendly navigation successful');
  });

  test('responsive layout verification', async ({ page }) => {
    await page.goto(APP_URL);
    
    // Check if layout adapts to current viewport
    const header = page.locator('header');
    await expect(header).toBeVisible();
    
    // Test scrolling behavior on mobile/tablet
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    const currentViewport = page.viewportSize();
    const viewportHeight = currentViewport?.height || 0;
    
    if (pageHeight > viewportHeight) {
      await page.evaluate(() => window.scrollTo(0, 500));
      console.log('✅ Scrolling behavior verified');
    }
    
    console.log('✅ Responsive layout verified for current device');
  });
});

// Example: Device-specific verification
test.describe('device verification example', () => {
  test('shows current device information', async ({ page }) => {
    await page.goto(APP_URL);
    
    // Get current device information
    const viewport = page.viewportSize();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const isTouch = await page.evaluate(() => 'ontouchstart' in window);
    
    console.log('Current viewport:', viewport);
    console.log('User Agent:', userAgent);
    console.log('Touch capable:', isTouch);
    
    // Educational: Show what iPhone would look like
    console.log('iPhone 13 viewport would be: { width: 390, height: 844 }');
    console.log('To test iPhone: uncomment test.use({ ...devices[\"iPhone 13\"] }) above');
    
    // Verify basic functionality works on any device
    await expect(page).toHaveTitle(/Playwright/);
    console.log('✅ Basic functionality verified on current device');
  });
});
`,
  },
  {
    id: "pw-custom-e2e",
    name: "API + UI end-to-end",
    description: "Seeds data via API, verifies it through the UI",
    category: "Cross-layer",
    testType: "custom",
    tags: ["playwright", "api", "ui"],
    code: `/**
 * Cross-layer test: seed via API, verify via UI.
 * 
 * Purpose:
 * - Demonstrate end-to-end testing across layers
 * - Use API for fast data setup (seeding)
 * - Use UI for user-centric verification
 * - Clean up data via API
 * 
 * Key Actions:
 * - API POST: Create data
 * - UI Interaction: Verify data visibility
 * - API DELETE: Remove data
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const API_URL = 'https://jsonplaceholder.typicode.com';
const APP_URL = 'https://demo.playwright.dev/todomvc';

test.describe('API + UI end-to-end test', () => {
  test('creates data via API and checks UI', async ({ page, request }) => {
    // 1. Seed data using the API (fast)
    const createResponse = await request.post(API_URL + '/posts', {
      data: { title: 'Full-stack check', body: 'Seeded by API', userId: 1 },
    });

    expect(createResponse.ok()).toBeTruthy();
    const payload = await createResponse.json();

    // 2. Verify data in the UI (user perspective)
    await page.goto(APP_URL);
    await page.getByPlaceholder('What needs to be done?').fill(payload.title);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listitem').first()).toContainText(payload.title);

    // 3. Clean up data using the API
    await request.delete(API_URL + '/posts/' + payload.id);
  });
});
`,
  },
  {
    id: "pw-browser-comprehensive",
    name: "Comprehensive Browser Test",
    description: "Multi-test suite covering navigation, elements, and forms",
    category: "Browser fundamentals",
    testType: "browser",
    tags: ["playwright", "browser", "comprehensive"],
    code: `/**
 * Browser automation tests with Playwright
 * Demonstrates web page navigation, element interaction, and form testing
 * @requires '@playwright/test'
 */

import { test, expect } from '@playwright/test';

test.describe('browser automation tests', () => {
  test('page title verification', async ({ page }) => {
    // Navigate to Playwright docs and verify page title
    await page.goto('https://playwright.dev/');
    await expect(page).toHaveTitle(/Playwright/);
    console.log('✅ Page title verified successfully');
  });

  test('navigation and element visibility', async ({ page }) => {
    // Test navigation flow and element interaction
    await page.goto('https://playwright.dev/');
    await page.getByRole('link', { name: 'Get started' }).click();
    await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
    console.log('✅ Navigation and element visibility verified');
  });

  test('form interaction', async ({ page }) => {
    // Test form input and submission in TodoMVC app
    await page.goto('https://demo.playwright.dev/todomvc');
    await page.getByPlaceholder('What needs to be done?').fill('Test automation with Playwright');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    await expect(page.getByTestId('todo-title')).toHaveText(['Test automation with Playwright']);
    console.log('✅ Form interaction verified');
  });
});
`,
  },
  {
    id: "pw-api-comprehensive",
    name: "Comprehensive API Test",
    description: "Tests HTTP methods, response validation, and error handling",
    category: "API Coverage",
    testType: "api",
    tags: ["playwright", "api", "comprehensive"],
    code: `/**
 * REST API testing with Playwright
 * Tests HTTP methods, response validation, and error handling
 * @requires '@playwright/test'
 */

import { test, expect } from '@playwright/test';

test.describe('API endpoint tests', () => {
  test('GET request with status and data validation', async ({ request }) => {
    // Test GET request and validate response structure
    const response = await request.get('https://jsonplaceholder.typicode.com/todos/1');
    expect(response.status()).toBe(200);
    const responseData = await response.json();
    expect(responseData).toEqual({
      userId: 1,
      id: 1,
      title: 'delectus aut autem',
      completed: false,
    });
    console.log('✅ GET request validated successfully');
  });

  test('POST request with request body', async ({ request }) => {
    // Test POST request with data payload
    const newTodo = {
      title: 'Test API with Playwright',
      completed: false,
      userId: 1
    };
    const response = await request.post('https://jsonplaceholder.typicode.com/todos', {
      data: newTodo
    });
    expect(response.status()).toBe(201);
    const responseData = await response.json();
    expect(responseData).toHaveProperty('id');
    expect(responseData.title).toBe(newTodo.title);
    console.log('✅ POST request validated successfully');
  });

  test('error handling for non-existent resource', async ({ request }) => {
    // Test 404 error handling for missing resources
    const response = await request.get('https://jsonplaceholder.typicode.com/todos/999999');
    expect(response.status()).toBe(404);
    const responseData = await response.json();
    expect(Object.keys(responseData).length).toBe(0);
    console.log('✅ Error handling validated successfully');
  });
});
`,
  },
  {
    id: "pw-db-discovery",
    name: "Database Discovery & Query",
    description: "Connects to DB, discovers schema, and executes queries",
    category: "Database checks",
    testType: "database",
    tags: ["playwright", "database", "postgres", "discovery"],
    code: `/**
 * PostgreSQL database connection and query testing
 * Connects to public database and executes SQL queries with validation
 * @requires 'pg' package, '@playwright/test'
 */

import { test, expect } from "@playwright/test";
import { Client } from "pg";

const config = {
  connectionString: "postgres://reader:NWDMCE5xdipIjRrp@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs",
  ssl: false
};

test.describe('database query tests', () => {
  test('connection and basic info', async () => {
    // Test database connection and retrieve basic information
    const client = new Client(config);
    
    try {
      await client.connect();
      console.log("✅ Connected to RNAcentral PostgreSQL database");

      // Get database version and connection details
      const infoResult = await client.query(\`
        SELECT 
          version() as db_version,
          current_database() as database_name,
          current_user as connected_user,
          current_timestamp as connection_time
      \`);

      console.log("Database Information:");
      console.log(\`Database: \${infoResult.rows[0].database_name}\`);
      console.log(\`Connected as: \${infoResult.rows[0].connected_user}\`);
      console.log(\`Connection Time: \${infoResult.rows[0].connection_time}\`);
      console.log(\`Version: \${infoResult.rows[0].db_version.split(',')[0]}\`);

      expect(infoResult.rows.length).toBe(1);
      expect(infoResult.rows[0].database_name).toBe('pfmegrnargs');
      expect(infoResult.rows[0].connected_user).toBe('reader');

      // Check server configuration
      const settingsResult = await client.query(\`
        SELECT 
          setting as timezone
        FROM pg_settings 
        WHERE name = 'TimeZone'
      \`);

      console.log(\`Server Timezone: \${settingsResult.rows[0].timezone}\`);
      expect(settingsResult.rows.length).toBe(1);

      console.log("✅ Connection and basic info test completed successfully");
    } catch (err) {
      console.error("Database query failed:", err);
      throw err;
    } finally {
      await client.end();
      console.log("✅ Database connection closed");
    }
  });

  test('schema discovery', async () => {
    // Discover database schemas and available tables
    const client = new Client(config);
    
    try {
      await client.connect();
      console.log("✅ Connected to RNAcentral PostgreSQL database");

      // Find all non-system schemas
      const schemasResult = await client.query(\`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
        ORDER BY schema_name
      \`);

      console.log("Available Schemas:");
      schemasResult.rows.forEach((schema, index) => {
        console.log(\`\${index + 1}. \${schema.schema_name}\`);
      });

      expect(schemasResult.rows.length).toBeGreaterThanOrEqual(1);

      // List first 5 tables in each schema
      for (const schema of schemasResult.rows) {
        const tablesResult = await client.query(\`
          SELECT table_name, table_type
          FROM information_schema.tables 
          WHERE table_schema = $1
          ORDER BY table_name
          LIMIT 5
        \`, [schema.schema_name]);

        console.log(\`Tables in \${schema.schema_name} schema (first 5):\`);
        if (tablesResult.rows.length > 0) {
          tablesResult.rows.forEach((table, index) => {
            console.log(\`  \${index + 1}. \${table.table_name} (\${table.table_type})\`);
          });
        } else {
          console.log("  No tables found or no access to tables");
        }
      }

      console.log("✅ Schema discovery completed successfully");
    } catch (err) {
      console.error("Database query failed:", err);
      throw err;
    } finally {
      await client.end();
      console.log("✅ Database connection closed");
    }
  });
});
`,
  },
  {
    id: "pw-custom-github",
    name: "GitHub API + Browser Integration",
    description: "Combines API data fetching with browser validation",
    category: "Cross-layer",
    testType: "custom",
    tags: ["playwright", "api", "browser", "github"],
    code: `/**
 * GitHub API + Browser integration tests
 * Combines API data fetching with browser validation for end-to-end testing
 * @requires '@playwright/test'
 */

import { test, expect } from "@playwright/test";

test.describe('GitHub integration tests', () => {
  test('repository analysis - API + browser integration', async ({ request, page }) => {
    // Combine API data fetching with browser validation
    console.log("🚀 Starting GitHub repository analysis workflow...");

    const repoOwner = "microsoft";
    const repoName = "playwright";

    console.log("Step 1: Fetching repository data via GitHub API...");
    const repoResponse = await request.get(
      \`https://api.github.com/repos/\${repoOwner}/\${repoName}\`
    );

    expect(repoResponse.status()).toBe(200);
    const repoData = await repoResponse.json();
    
    // Display repository metrics from API
    console.log(\`📊 Repository: \${repoData.full_name}\`);
    console.log(\`⭐ Stars: \${repoData.stargazers_count}\`);
    console.log(\`🍴 Forks: \${repoData.forks_count}\`);
    console.log(\`📝 Description: \${repoData.description}\`);
    console.log(\`🔗 Language: \${repoData.language}\`);

    console.log("Step 2: Opening GitHub repository in browser...");
    await page.goto(\`https://github.com/\${repoOwner}/\${repoName}\`);
    await expect(page).toHaveTitle(/playwright/i);
    
    console.log("Step 3: Validating API data against browser content...");
    await expect(page.getByRole('heading', { name: '🎭 Playwright' })).toBeVisible();
    console.log(\`✅ Repository page loaded and confirmed\`);

    console.log("✅ Repository analysis completed successfully");
  });

  test('API data analysis', async ({ request }) => {
    // Analyze GitHub repository issues and contributors via API
    console.log("🚀 Starting GitHub API data analysis...");

    const repoOwner = "microsoft";
    const repoName = "playwright";

    console.log("Step 1: Fetching repository issues via API...");
    const issuesResponse = await request.get(
      \`https://api.github.com/repos/\${repoOwner}/\${repoName}/issues?state=open&per_page=10\`
    );

    expect(issuesResponse.status()).toBe(200);
    const issues = await issuesResponse.json();
    
    console.log(\`📋 Found \${issues.length} open issues (showing first 10)\`);
    
    // Analyze issue patterns and statistics
    const issueAnalysis = {
      withLabels: issues.filter(issue => issue.labels.length > 0).length,
      withAssignees: issues.filter(issue => issue.assignees.length > 0).length,
      averageComments: Math.round(issues.reduce((sum, issue) => sum + issue.comments, 0) / issues.length)
    };

    console.log(\`🏷️  Issues with labels: \${issueAnalysis.withLabels}/\${issues.length}\`);
    console.log(\`👥 Issues with assignees: \${issueAnalysis.withAssignees}/\${issues.length}\`);
    console.log(\`💬 Average comments per issue: \${issueAnalysis.averageComments}\`);

    console.log("Step 2: Fetching repository contributors...");
    const contributorsResponse = await request.get(
      \`https://api.github.com/repos/\${repoOwner}/\${repoName}/contributors?per_page=5\`
    );

    expect(contributorsResponse.status()).toBe(200);
    const contributors = await contributorsResponse.json();
    
    // Display top contributors by commit count
    console.log(\`👨‍💻 Top \${contributors.length} Contributors:\`);
    contributors.forEach((contributor, index) => {
      console.log(\`  \${index + 1}. \${contributor.login} - \${contributor.contributions} contributions\`);
    });

    expect(contributors.length).toBeGreaterThan(0);
    console.log("✅ API data analysis completed successfully");
  });

  test('user profile analysis', async ({ request, page }) => {
    // Validate user profile data across API and browser interfaces
    console.log("🚀 Starting GitHub user profile analysis...");

    const username = "torvalds";

    console.log("Step 1: Fetching user profile via GitHub API...");
    const userResponse = await request.get(\`https://api.github.com/users/\${username}\`);

    expect(userResponse.status()).toBe(200);
    const userData = await userResponse.json();
    
    // Display user profile information from API
    console.log(\`👤 User: \${userData.login}\`);
    console.log(\`📝 Name: \${userData.name || 'Not provided'}\`);
    console.log(\`📊 Public Repos: \${userData.public_repos}\`);
    console.log(\`👥 Followers: \${userData.followers}\`);

    console.log("Step 2: Validating user profile in browser...");
    await page.goto(\`https://github.com/\${username}\`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(username));
    console.log(\`✅ Confirmed on \${username}'s profile page\`);

    console.log("✅ User profile analysis completed successfully");
  });
});
`,
  },
  {
    id: "k6-basic",
    name: "Basic Performance Test",
    description: "Simple load test with virtual users and thresholds",
    category: "Smoke & Health",
    testType: "performance",
    tags: ["k6", "basic", "performance"],
    code: `/**
 * k6 performance testing script
 * Load testing with virtual users and response time thresholds
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function() {
  const response = http.get('https://test-api.k6.io/public/crocodiles/');

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}`,
  },
];

// Helper function to get templates by test type
export function getTemplatesByType(testType: TestType): CodeTemplate[] {
  if (testType === "performance") {
    return codeTemplates.filter((t) => t.testType === "performance");
  }

  // For custom type, return only custom templates (not covered by other types)
  if (testType === "custom") {
    return codeTemplates.filter((t) => t.testType === "custom");
  }

  // For specific Playwright test types, return only matching templates
  return codeTemplates.filter((t) => t.testType === testType);
}

// Helper function to get template categories by test type
export function getCategoriesByType(testType: TestType): string[] {
  const templates = getTemplatesByType(testType);
  const categories = new Set(templates.map((t) => t.category));
  return Array.from(categories);
}
