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

  // =========================
  // Playwright Browser Templates
  // =========================
  {
    id: "pw-browser-smoke",
    name: "UI Smoke (navigation)",
    description: "Loads the app and confirms core UI renders",
    category: "Browser fundamentals",
    testType: "browser",
    tags: ["playwright", "smoke", "ui"],
    code: `/**
 * Playwright UI smoke for a Todo-style app.
 * Coverage: navigation, title, primary input, add item.
 * Config: headless default; swap APP_URL for your target.
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

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
    description: "Emulates a mobile device and checks key controls",
    category: "Responsive & devices",
    testType: "browser",
    tags: ["playwright", "mobile", "responsive"],
    code: `/**
 * Mobile viewport check using device emulation.
 * Coverage: viewport size, key controls, mobile menu.
 * Swap APP_URL/selectors to match your app's responsive UI.
 * @requires @playwright/test
 */

import { devices, expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

test.use({ ...devices['iPhone 13'] });

test('mobile layout exposes key actions', async ({ page }) => {
  await page.goto(APP_URL);

  const viewport = page.viewportSize();
  expect(viewport?.width).toBe(390);

  await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();

  await page.getByRole('button', { name: /menu/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
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
