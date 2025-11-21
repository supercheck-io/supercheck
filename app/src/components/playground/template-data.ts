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
 * Coverage: single GET, status + basic body check, light load.
 * Config: 3 VUs for 30s, p95 < 800ms, errors < 1%.
 * Use TARGET_URL k6 var to point at your API.
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 3,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const baseUrl = __ENV.TARGET_URL || 'https://test-api.k6.io';
  const response = http.get(baseUrl + '/public/crocodiles/1/');

  check(response, {
    'status is 200': (res) => res.status === 200,
    'body is not empty': (res) => res.body && res.body.length > 0,
  });

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
 * Ramping load profile to mirror real traffic.
 * Coverage: staged VU growth, p95/p99 latency guardrails, error budget.
 * Config: 2m->5m->3m stages, max 80 VUs, p95 < 600ms, p99 < 1200ms.
 * Use TARGET_URL to switch environments without code edits.
 * @requires k6 binary
 */

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 10 },
    { duration: '5m', target: 50 },
    { duration: '3m', target: 80 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<600', 'p(99)<1200'],
    checks: ['rate>0.95'],
  },
};

export default function () {
  const baseUrl = __ENV.TARGET_URL || 'https://test-api.k6.io';
  const response = http.get(baseUrl + '/public/crocodiles/');

  check(response, {
    'status is 200': (res) => res.status === 200,
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
 * Coverage: sudden arrival spike, p99 latency, error ceiling.
 * Config: ramp to 200 iters/s then back down, maxVUs 200.
 * Uses ramping-arrival-rate executor with recovery stage.
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '30s', target: 200 },
        { duration: '1m', target: 20 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(99)<1500'],
  },
};

export default function () {
  const baseUrl = __ENV.TARGET_URL || 'https://test-api.k6.io';
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
 * Soak test to surface long-running degradations.
 * Coverage: steady load, leak detection, latency drift watch.
 * Config: 20 VUs for 20m with gentle ramp, p95 < 700ms.
 * Great for spotting connection pool or memory issues.
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5m', target: 20 },
    { duration: '20m', target: 20 },
    { duration: '5m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<700'],
  },
};

export default function () {
  const baseUrl = __ENV.TARGET_URL || 'https://test-api.k6.io';
  const response = http.get(baseUrl + '/public/crocodiles/3/');

  check(response, { 'status is 200': (res) => res.status === 200 });
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
 * Coverage: list + create + auth-only endpoint, grouped checks.
 * Config: 20 VUs for 2m, p95 < 450ms, errors < 2%.
 * Provide API_TOKEN via k6 env for auth portion.
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
  const baseUrl = __ENV.TARGET_URL || 'https://test-api.k6.io';
  const token = __ENV.API_TOKEN || '';

  group('list resources', () => {
    const res = http.get(baseUrl + '/public/crocodiles/');
    check(res, { 'listed resources': (r) => r.status === 200 });
  });

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
 * Coverage: status checks, header validation, body assertions, timing checks.
 * Demonstrates check() patterns and custom metrics.
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
    'custom_error_rate': ['rate<0.05'],
    'custom_duration': ['avg<300', 'p(90)<400'],
    'checks': ['rate>0.95'],
  },
};

export default function () {
  const baseUrl = __ENV.TARGET_URL || 'https://jsonplaceholder.typicode.com';
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
 * Advanced k6 thresholds for SLO enforcement.
 * Coverage: complex thresholds, custom metrics, tagged metrics.
 * Uses jsonplaceholder for reliable demo endpoint.
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
    'http_req_duration{endpoint:read}': ['p(95)<400'],
    'http_req_duration{endpoint:write}': ['p(95)<500'],
  },
};

export default function () {
  const baseUrl = __ENV.TARGET_URL || 'https://jsonplaceholder.typicode.com';
  
  // Read operation
  const getRes = http.get(baseUrl + '/posts/1', {
    tags: { endpoint: 'read' },
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
      tags: { endpoint: 'write' },
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
 * Coverage: gradual load increase, find max capacity, monitor degradation.
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '5m', target: 200 },
    { duration: '2m', target: 300 },
    { duration: '5m', target: 300 },
    { duration: '5m', target: 0 },
  ],
  
  thresholds: {
    'http_req_failed': ['rate<0.1'],
    'http_req_duration': ['p(95)<5000'],
    'errors': ['rate<0.15'],
  },
};

export default function () {
  const baseUrl = __ENV.TARGET_URL || 'https://test-api.k6.io';
  
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
 * Coverage: incremental load increase, precise capacity measurement.
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
    { target: 1000, duration: '10m' },
  ],
  
  thresholds: {
    'http_req_failed': [{ threshold: 'rate<0.05', abortOnFail: true }],
    'http_req_duration': [{ threshold: 'p(99)<3000', abortOnFail: true }],
  },
};

export default function () {
  const res = http.get(__ENV.TARGET_URL || 'https://test-api.k6.io/public/crocodiles/');
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
 * Playwright UI smoke for a Todo-style app.
 * Coverage: navigation, title, primary input, add item.
 * Default: Runs in Chromium (no tag needed).
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

// No tag = Chromium (default)
test('home page renders primary UI', async ({ page }) => {
  await page.goto(APP_URL);

  await expect(page).toHaveTitle(/TodoMVC/);
  await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();

  await page.getByPlaceholder('What needs to be done?').fill('Smoke task');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listitem').first()).toContainText('Smoke task');
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
 * Auth flow covering login and logout.
 * Coverage: form fill, post-login assertion, logout redirect.
 * Replace baseUrl and credentials with your app fixtures.
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://the-internet.herokuapp.com';
const CREDENTIALS = { username: 'tomsmith', password: 'SuperSecretPassword!' };

test('user can sign in and sign out', async ({ page }) => {
  await page.goto(APP_URL + '/login');

  await page.getByLabel('Username').fill(CREDENTIALS.username);
  await page.getByLabel('Password').fill(CREDENTIALS.password);
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByText('You logged into a secure area!')).toBeVisible();
  await page.getByRole('link', { name: 'Logout' }).click();
  await expect(page).toHaveURL(APP_URL + '/login');
});
`,
  },
  {
    id: "pw-browser-form",
    name: "Form with stubbed API",
    description: "Submits a form while stubbing the backend response",
    category: "Forms",
    testType: "browser",
    tags: ["playwright", "forms", "stubbing"],
    code: `/**
 * Form submission with network stubbing.
 * Coverage: label-based fields, POST stub, success message.
 * Keeps test hermetic by fulfilling the request client-side.
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://example.com/contact';

test('submits contact form with stubbed API', async ({ page }) => {
  await page.route('**/contact', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.continue();
    }

    let body = {};
    try {
      body = route.request().postDataJSON() || {};
    } catch {
      body = {};
    }

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ...body, id: 42 }),
    });
  });

  await page.goto(APP_URL);

  await page.getByLabel('Full name').fill('Playwright User');
  await page.getByLabel('Email address').fill('qa@example.com');
  await page.getByLabel('Message').fill('Checking the happy path');
  await page.getByRole('button', { name: /send/i }).click();

  await expect(page.getByText('Thanks')).toBeVisible();
});
`,
  },
  {
    id: "pw-browser-responsive",
    name: "Mobile / responsive layout",
    description: "Emulates iPhone 16 and checks key controls",
    category: "Responsive & devices",
    testType: "browser",
    tags: ["playwright", "mobile", "responsive"],
    code: `/**
 * Mobile viewport check using @mobile tag.
 * Coverage: viewport size, key controls, mobile menu.
 * Tag: @mobile or @iPhone → Runs in mobile-safari project (iPhone 16).
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

// Use @mobile tag to run on iPhone 16
test('mobile layout exposes key actions @mobile', async ({ page }) => {
  await page.goto(APP_URL);

  const viewport = page.viewportSize();
  expect(viewport?.width).toBe(390);

  await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();

  await page.getByRole('button', { name: /menu/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
});

// Alternative: Use @iPhone tag (same as @mobile)
test('touch gestures work @iPhone', async ({ page }) => {
  await page.goto(APP_URL);
  await page.getByPlaceholder('What needs to be done?').fill('Mobile task');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listitem').first()).toContainText('Mobile task');
});
`,
  },
  {
    id: "pw-browser-firefox",
    name: "Firefox compatibility",
    description: "Tests Firefox-specific rendering and behavior",
    category: "Browser fundamentals",
    testType: "browser",
    tags: ["playwright", "firefox", "compatibility"],
    code: `/**
 * Firefox-specific browser test.
 * Coverage: Firefox rendering, user agent, browser behavior.
 * Tag: @firefox → Runs in firefox project (Desktop Firefox).
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

// Use @firefox tag to run in Firefox
test('firefox rendering check @firefox', async ({ page }) => {
  await page.goto(APP_URL);

  await expect(page).toHaveTitle(/TodoMVC/);
  
  // Verify we're running in Firefox
  const userAgent = await page.evaluate(() => navigator.userAgent);
  expect(userAgent).toContain('Firefox');
  
  // Test Firefox-specific features or workarounds
  await page.getByPlaceholder('What needs to be done?').fill('Firefox task');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listitem').first()).toContainText('Firefox task');
});
`,
  },
  {
    id: "pw-browser-webkit",
    name: "WebKit / Safari compatibility",
    description: "Tests WebKit-specific rendering (Safari)",
    category: "Browser fundamentals",
    testType: "browser",
    tags: ["playwright", "webkit", "safari"],
    code: `/**
 * WebKit/Safari-specific browser test.
 * Coverage: Safari rendering, user agent, browser behavior.
 * Tag: @webkit or @safari → Runs in webkit project (Desktop Safari).
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

// Use @safari tag to run in WebKit (Safari)
test('safari compatibility check @safari', async ({ page }) => {
  await page.goto(APP_URL);

  await expect(page).toHaveTitle(/TodoMVC/);
  
  // Verify we're running in WebKit
  const userAgent = await page.evaluate(() => navigator.userAgent);
  expect(userAgent).toContain('Safari');
  
  // Test Safari-specific features
  await page.getByPlaceholder('What needs to be done?').fill('Safari task');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listitem').first()).toContainText('Safari task');
});

// Alternative: Use @webkit tag (same as @safari)
test('webkit rendering @webkit', async ({ page }) => {
  await page.goto(APP_URL);
  await page.getByPlaceholder('What needs to be done?').fill('WebKit task');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listitem').first()).toContainText('WebKit task');
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
 * Coverage: GPS coordinates, language preferences, time zones.
 * Useful for testing location-based features and i18n.
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

test.use({
  // Set geolocation
  geolocation: { longitude: 12.492507, latitude: 41.889938 }, // Rome, Italy
  permissions: ['geolocation'],
  
  // Set locale and timezone
  locale: 'it-IT',
  timezoneId: 'Europe/Rome',
});

test('app responds to geolocation and locale', async ({ page }) => {
  await page.goto(APP_URL);
  
  // Verify geolocation is available
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
  
  // Verify locale
  const locale = await page.evaluate(() => navigator.language);
  expect(locale).toBe('it-IT');
});
`,
  },
  {
    id: "pw-browser-fixtures",
    name: "Custom test fixtures",
    description: "Creates reusable page objects and test data",
    category: "Browser fundamentals",
    testType: "browser",
    tags: ["playwright", "fixtures", "page-object"],
    code: `/**
 * Custom fixtures for reusable test components.
 * Coverage: page objects, test data, authentication state.
 * Demonstrates the fixtures pattern for maintainable tests.
 * @requires @playwright/test
 */

import { test as base, expect } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

// Define a page object interface
type TodoPage = {
  goto: () => Promise<void>;
  addTodo: (text: string) => Promise<void>;
  getTodoText: (index: number) => Promise<string>;
};

// Extend base test with custom fixtures
const test = base.extend({
  todoPage: async ({ page }, use) => {
    // Create page object methods
    const todoPage = {
      goto: async () => {
        await page.goto(APP_URL);
      },
      
      addTodo: async (text: string) => {
        await page.getByPlaceholder('What needs to be done?').fill(text);
        await page.keyboard.press('Enter');
      },
      
      getTodoText: async (index: number) => {
        const text = await page.getByRole('listitem').nth(index).textContent();
        return text || '';
      },
    };
    
    // Navigate to app before each test
    await todoPage.goto();
    await use(todoPage);
  },
});

// Use the fixture in tests
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
 * Coverage: status, headers, JSON fields, type assertions.
 * Great for quick monitors of critical endpoints.
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const API_URL = 'https://jsonplaceholder.typicode.com';

test('health endpoint responds with expected payload', async ({ request }) => {
  const response = await request.get(API_URL + '/posts/1');

  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');

  const body = await response.json();
  expect(body).toMatchObject({ id: 1 });
  expect(typeof body.title).toBe('string');
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
 * Coverage: POST create, GET verify, DELETE cleanup.
 * Uses test.describe.serial to share created ID safely.
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const API_URL = 'https://jsonplaceholder.typicode.com';

test.describe.serial('posts CRUD', () => {
  let createdId: number | undefined;

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
    test.skip(!createdId, 'create step failed');
    const response = await request.get(API_URL + '/posts/' + createdId);
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.id).toBe(createdId);
  });

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
 * Coverage: header injection, 200 assertion, key fields validation.
 * Replace API_URL and API_TOKEN with your secured endpoint.
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const API_URL = 'https://api.example.com';
const API_TOKEN = 'replace-with-token';

test('authenticated profile request', async ({ request }) => {
  const api = await request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { Authorization: 'Bearer ' + API_TOKEN },
  });

  const response = await api.get('/user/profile');
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body).toHaveProperty('email');
  expect(body).toHaveProperty('id');

  await api.dispose();
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
 * Coverage: connection, simple SELECT, column existence.
 * Swap connection string for your database user/host.
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
test('users table returns expected columns', async () => {
  const result = await pool.query('SELECT id, email FROM users LIMIT 1');
  expect(result.rowCount).toBeGreaterThan(0);
  expect(result.rows[0]).toHaveProperty('email');
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
 * Coverage: BEGIN/ROLLBACK, returned row validation, cleanup assertion.
 * Keeps test data out of shared environments.
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
test('insert + rollback keeps DB clean', async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const inserted = await client.query(
      'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, name',
      ['playwright@example.com', 'Playwright Test']
    );

    expect(inserted.rowCount).toBe(1);
    expect(inserted.rows[0].email).toBe('playwright@example.com');

    await client.query('ROLLBACK');

    const check = await client.query(
      'SELECT 1 FROM users WHERE email = $1',
      ['playwright@example.com']
    );
    expect(check.rowCount).toBe(0);
  } finally {
    client.release();
  }
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
 * Coverage: scoped update, affected rows, value assertions.
 * Ensures you never run unbounded updates in tests.
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
test('updates a user safely', async () => {
  const result = await pool.query(
    'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name',
    ['Updated Name', 1]
  );

  expect(result.rowCount).toBe(1);
  expect(result.rows[0].id).toBe(1);
  expect(result.rows[0].name).toBe('Updated Name');
});
`,
  },

  // =========================
  // Cross-layer Custom Template
  // =========================
  {
    id: "pw-custom-e2e",
    name: "API + UI end-to-end",
    description: "Seeds data via API, verifies it through the UI",
    category: "Cross-layer",
    testType: "custom",
    tags: ["playwright", "api", "ui"],
    code: `/**
 * Cross-layer test: seed via API, verify via UI.
 * Coverage: POST seed, UI add/read, optional API cleanup.
 * Swap API_URL/APP_URL/selectors to match your product.
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const API_URL = 'https://jsonplaceholder.typicode.com';
const APP_URL = 'https://demo.playwright.dev/todomvc';

test('creates data via API and checks UI', async ({ page, request }) => {
  const createResponse = await request.post(API_URL + '/posts', {
    data: { title: 'Full-stack check', body: 'Seeded by API', userId: 1 },
  });

  expect(createResponse.ok()).toBeTruthy();
  const payload = await createResponse.json();

  await page.goto(APP_URL);
  await page.getByPlaceholder('What needs to be done?').fill(payload.title);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listitem').first()).toContainText(payload.title);

  await request.delete(API_URL + '/posts/' + payload.id);
});
`,
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
