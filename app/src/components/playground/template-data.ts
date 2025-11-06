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
  // K6 Performance Test Templates
  {
    id: "k6-basic-load",
    name: "Basic Load Test",
    description: "Simple load test with virtual users",
    category: "Load Testing",
    testType: "performance",
    tags: ["k6", "load", "basic"],
    code: `/**
 * Sample k6 Performance Test Script
 *
 * This script demonstrates k6 performance and load testing capabilities.
 * k6 is a modern load testing tool for testing the performance of APIs,
 * microservices, and websites. It uses JavaScript ES6 for test scripting.
 *
 * Test Coverage:
 * - HTTP GET request performance testing
 * - Virtual users (VUs) simulation
 * - Response time analysis (avg, p95, p99)
 * - Pass/fail thresholds validation
 * - Error rate monitoring
 *
 * Configuration:
 * - 10 virtual users
 * - 30 second test duration
 * - Success criteria: 95% of requests < 500ms, error rate < 10%
 *
 * Target API: test-api.k6.io - k6's official test API
 * Documentation: https://k6.io/docs/
 *
 * @requires k6 binary
 */

import http from 'k6/http';
import { sleep, check } from 'k6';

// Test configuration - all settings in script
export const options = {
  vus: 10,              // 10 virtual users
  duration: '30s',      // Run for 30 seconds
};

// Main test function - runs for each virtual user
export default function() {
  // Make HTTP request
  const res = http.get('https://test-api.k6.io/public/crocodiles/');

  // Validate response
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  // Think time between requests
  sleep(1);
}`,
  },
  {
    id: "k6-spike-test",
    name: "Spike Test",
    description: "Test sudden traffic spikes",
    category: "Load Testing",
    testType: "performance",
    tags: ["k6", "spike", "stress"],
    code: `/**
 * k6 Spike Test Script
 *
 * This script tests system behavior under sudden traffic spikes.
 * Spike testing validates how your system handles sudden, dramatic
 * increases in load and how quickly it recovers when load decreases.
 *
 * Test Coverage:
 * - Sudden load increase (spike) simulation
 * - System stability under rapid load changes
 * - Recovery time measurement
 * - Error rate during spikes
 * - Response time degradation
 *
 * Configuration:
 * - Ramp up from 0 to 100 users in 10 seconds
 * - Sustain 100 users for 1 minute
 * - Rapid ramp down to 0 in 10 seconds
 *
 * Use Cases:
 * - Testing system behavior during viral events
 * - Validating auto-scaling response
 * - Finding breaking points
 *
 * Target API: test-api.k6.io
 * Documentation: https://k6.io/docs/test-types/spike-testing/
 *
 * @requires k6 binary
 */

import http from 'k6/http';
import { sleep, check } from 'k6';

// Test configuration with spike pattern
export const options = {
  stages: [
    { duration: '10s', target: 100 }, // Fast ramp-up to high load
    { duration: '1m', target: 100 },  // Stay at high load
    { duration: '10s', target: 0 },   // Quick ramp-down
  ],
};

// Main test function
export default function() {
  // Make HTTP request
  const res = http.get('https://test-api.k6.io/public/crocodiles/');

  // Validate response
  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  // Think time
  sleep(1);
}`,
  },
  {
    id: "k6-stress-test",
    name: "Stress Test",
    description: "Gradually increase load to find limits",
    category: "Load Testing",
    testType: "performance",
    tags: ["k6", "stress", "capacity"],
    code: `/**
 * k6 Stress Test Script
 *
 * This script gradually increases load to find system limits and breaking points.
 * Stress testing helps identify the maximum capacity your system can handle
 * before performance degrades or failures occur.
 *
 * Test Coverage:
 * - Gradual load increase (stress ramp)
 * - System capacity limits identification
 * - Performance degradation points
 * - Resource exhaustion detection
 * - Recovery behavior validation
 *
 * Configuration:
 * - Gradual ramp: 10 → 50 → 100 users
 * - Multiple stages with sustained load
 * - Thresholds: p95 < 500ms, error rate < 1%
 * - Total duration: ~25 minutes
 *
 * Success Criteria:
 * - 95% of requests complete under 500ms
 * - Error rate stays below 1%
 *
 * Target API: test-api.k6.io
 * Documentation: https://k6.io/docs/test-types/stress-testing/
 *
 * @requires k6 binary
 */

import http from 'k6/http';
import { sleep, check } from 'k6';

// Test configuration with gradual load increase
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Ramp up to 10 users
    { duration: '5m', target: 10 },   // Stay at 10 users
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '10m', target: 0 },   // Ramp down
  ],
  // Performance thresholds
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    http_req_failed: ['rate<0.01'],   // Error rate should be below 1%
  },
};

// Main test function
export default function() {
  // Make HTTP request
  const res = http.get('https://test-api.k6.io/public/crocodiles/');

  // Validate response
  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  // Think time
  sleep(1);
}`,
  },
  {
    id: "k6-soak-test",
    name: "Soak Test",
    description: "Test system stability over extended period",
    category: "Load Testing",
    testType: "performance",
    tags: ["k6", "soak", "endurance"],
    code: `/**
 * k6 Soak Test Script (Endurance Testing)
 *
 * This script tests system stability and reliability over extended periods.
 * Soak testing helps identify memory leaks, resource exhaustion, and
 * performance degradation that only appears after prolonged operation.
 *
 * Test Coverage:
 * - Extended duration load testing (2+ hours)
 * - Memory leak detection
 * - Resource exhaustion monitoring
 * - Performance consistency over time
 * - Database connection pool stability
 *
 * Configuration:
 * - 50 virtual users sustained for 2 hours
 * - Gradual 5-minute ramp up/down
 * - Thresholds: p95 < 500ms, error rate < 1%
 *
 * Monitoring Focus:
 * - Memory usage trends
 * - Response time consistency
 * - Error rate stability
 * - Resource utilization
 *
 * Target API: test-api.k6.io
 * Documentation: https://k6.io/docs/test-types/soak-testing/
 *
 * @requires k6 binary
 */

import http from 'k6/http';
import { sleep, check } from 'k6';

// Test configuration for endurance testing
export const options = {
  stages: [
    { duration: '5m', target: 50 },  // Ramp up
    { duration: '2h', target: 50 },  // Stay at load for 2 hours
    { duration: '5m', target: 0 },   // Ramp down
  ],
  // Performance thresholds
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

// Main test function
export default function() {
  // Make HTTP request
  const res = http.get('https://test-api.k6.io/public/crocodiles/');

  // Validate response
  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  // Think time
  sleep(1);
}`,
  },
  {
    id: "k6-api-test",
    name: "API Performance Test",
    description: "Test REST API endpoints with different methods",
    category: "API Testing",
    testType: "performance",
    tags: ["k6", "api", "rest"],
    code: `/**
 * k6 API Performance Test Script
 *
 * This script tests REST API performance with multiple HTTP methods.
 * Comprehensive API testing validates GET, POST, and other operations
 * under load to ensure API reliability and performance.
 *
 * Test Coverage:
 * - GET request performance
 * - POST request performance
 * - Request grouping and organization
 * - JSON payload handling
 * - Response validation
 *
 * Configuration:
 * - 20 virtual users
 * - 1 minute duration
 * - Thresholds: p95 < 300ms, error rate < 5%
 *
 * HTTP Methods Tested:
 * - GET: List retrieval
 * - POST: Resource creation with JSON payload
 *
 * Features:
 * - Grouped test organization
 * - JSON request/response handling
 * - Per-operation validation
 *
 * Target API: test-api.k6.io
 * Documentation: https://k6.io/docs/examples/api-crud-operations/
 *
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, group } from 'k6';

// Test configuration
export const options = {
  vus: 20,
  duration: '1m',
  // Performance thresholds
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.05'],
  },
};

// Main test function
export default function() {
  const baseUrl = 'https://test-api.k6.io';

  // Group related tests
  group('API Tests', function() {
    // GET request test
    group('GET /crocodiles', function() {
      const res = http.get(\`\${baseUrl}/public/crocodiles/\`);
      check(res, {
        'GET status is 200': (r) => r.status === 200,
        'GET has crocodiles': (r) => JSON.parse(r.body).length > 0,
      });
    });

    // POST request test
    group('POST /crocodile', function() {
      // Prepare request payload
      const payload = JSON.stringify({
        name: 'Test Croc',
        sex: 'M',
        date_of_birth: '2020-01-01',
      });

      // Set request headers
      const params = {
        headers: {
          'Content-Type': 'application/json',
        },
      };

      // Make POST request
      const res = http.post(\`\${baseUrl}/public/crocodiles/\`, payload, params);
      check(res, {
        'POST status is 201': (r) => r.status === 201,
      });
    });
  });
}`,
  },
  {
    id: "k6-browser-test",
    name: "Browser Performance Test",
    description: "Test web application with browser metrics",
    category: "Browser Testing",
    testType: "performance",
    tags: ["k6", "browser", "web"],
    code: `/**
 * k6 Browser Performance Test
 *
 * This script tests web application performance using k6's browser module.
 * The browser module enables real browser automation for performance testing,
 * combining load testing with actual browser rendering and JavaScript execution.
 *
 * Test Coverage:
 * - Browser-based performance testing
 * - Page load time measurement
 * - Element visibility validation
 * - Performance timing metrics
 * - Chromium browser automation
 *
 * Configuration:
 * - 1 virtual user
 * - 10 iterations
 * - Shared iterations executor
 * - Chromium browser engine
 *
 * Key Features:
 * - Async/await support (required for browser module)
 * - Real browser context with full JavaScript support
 * - Performance.timing API access
 * - Element locators and checks
 *
 * Target: test.k6.io - k6's official test site
 * Documentation: https://k6.io/docs/using-k6-browser/
 *
 * @requires k6 binary with browser support
 * @requires Chromium browser
 */

import { browser } from 'k6/experimental/browser';
import { check } from 'k6';

// Test configuration for browser testing
export const options = {
  scenarios: {
    ui: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 10,
      options: {
        browser: {
          type: 'chromium',
        },
      },
    },
  },
  // Performance thresholds
  thresholds: {
    checks: ['rate==1.0'],
  },
};

// Main test function - async is required for browser testing
export default async function() {
  // Create new browser page
  const page = browser.newPage();

  try {
    // Navigate to the page
    await page.goto('https://test.k6.io/');

    // Validate page loaded
    check(page, {
      'page loaded': page.locator('h1').textContent() !== '',
    });

    // Measure page load time
    const performanceTiming = page.evaluate(() => {
      return JSON.stringify(window.performance.timing);
    });

    console.log('Performance timing:', performanceTiming);
  } finally {
    // Close the page
    page.close();
  }
}`,
  },

  // Playwright Test Templates (for browser, api, database, custom)
  {
    id: "pw-basic-navigation",
    name: "Basic Navigation Test",
    description: "Simple page navigation and verification",
    category: "Browser Testing",
    testType: "browser",
    tags: ["playwright", "browser", "navigation"],
    code: `/**
 * Playwright Basic Navigation Test
 *
 * This test demonstrates basic browser automation and page navigation using Playwright.
 * It covers fundamental operations like navigation, title verification, and element visibility checks.
 *
 * Test Coverage:
 * - Page navigation and loading
 * - Page title validation
 * - Heading element visibility
 * - Text content verification
 * - CSS selector usage
 *
 * Use Cases:
 * - Smoke testing page availability
 * - Verifying basic page structure
 * - Validating content presence
 *
 * Target: example.com
 * Documentation: https://playwright.dev/docs/writing-tests
 *
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test('basic navigation test', async ({ page }) => {
  // Navigate to the page
  await page.goto('https://example.com');

  // Verify page title
  await expect(page).toHaveTitle(/Example Domain/);

  // Verify heading is visible
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // Verify page content
  await expect(page.locator('p').first()).toContainText('This domain is for use');
});`,
  },
  {
    id: "pw-form-interaction",
    name: "Form Interaction Test",
    description: "Test form filling and submission",
    category: "Browser Testing",
    testType: "browser",
    tags: ["playwright", "forms", "interaction"],
    code: `import { test, expect } from '@playwright/test';

test('form interaction test', async ({ page }) => {
  // Navigate to form page
  await page.goto('https://example.com/form');

  // Fill in form fields
  await page.getByLabel('Name').fill('John Doe');
  await page.getByLabel('Email').fill('john@example.com');
  await page.getByLabel('Message').fill('This is a test message');

  // Select from dropdown
  await page.getByLabel('Country').selectOption('US');

  // Check checkbox
  await page.getByLabel('I agree to terms').check();

  // Click submit button
  await page.getByRole('button', { name: 'Submit' }).click();

  // Verify success message
  await expect(page.getByText('Form submitted successfully')).toBeVisible();
});`,
  },
  {
    id: "pw-api-get",
    name: "API GET Request",
    description: "Test GET endpoint with assertions",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "get"],
    code: `import { test, expect } from '@playwright/test';

test('API GET request', async ({ request }) => {
  // Make GET request
  const response = await request.get('https://jsonplaceholder.typicode.com/posts/1');

  // Verify response status
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);

  // Parse and validate response data
  const data = await response.json();
  expect(data).toHaveProperty('id', 1);
  expect(data).toHaveProperty('title');
  expect(data).toHaveProperty('body');
  expect(data).toHaveProperty('userId');
});`,
  },
  {
    id: "pw-api-post",
    name: "API POST Request",
    description: "Test POST endpoint with data",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "post"],
    code: `import { test, expect } from '@playwright/test';

test('API POST request', async ({ request }) => {
  // Make POST request with data
  const response = await request.post('https://jsonplaceholder.typicode.com/posts', {
    data: {
      title: 'Test Post',
      body: 'This is a test post',
      userId: 1,
    },
  });

  // Verify response status
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(201);

  // Validate response data
  const data = await response.json();
  expect(data).toHaveProperty('id');
  expect(data.title).toBe('Test Post');
  expect(data.body).toBe('This is a test post');
});`,
  },
  {
    id: "pw-api-put",
    name: "API PUT Request",
    description: "Test PUT endpoint for updates",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "put"],
    code: `import { test, expect } from '@playwright/test';

test('API PUT request', async ({ request }) => {
  // Make PUT request to update resource
  const response = await request.put('https://jsonplaceholder.typicode.com/posts/1', {
    data: {
      id: 1,
      title: 'Updated Title',
      body: 'Updated body content',
      userId: 1,
    },
  });

  // Verify response status
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);

  // Validate updated data
  const data = await response.json();
  expect(data.title).toBe('Updated Title');
  expect(data.body).toBe('Updated body content');
});`,
  },
  {
    id: "pw-api-delete",
    name: "API DELETE Request",
    description: "Test DELETE endpoint",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "delete"],
    code: `import { test, expect } from '@playwright/test';

test('API DELETE request', async ({ request }) => {
  // Make DELETE request
  const response = await request.delete('https://jsonplaceholder.typicode.com/posts/1');

  // Verify response status
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);
});`,
  },
  {
    id: "pw-api-auth",
    name: "API Authentication",
    description: "Test API with authentication headers",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "auth"],
    code: `import { test, expect } from '@playwright/test';

test('API request with authentication', async ({ request }) => {
  // Make request with authentication header
  const response = await request.get('https://api.example.com/user/profile', {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN_HERE',
      'Content-Type': 'application/json',
    },
  });

  // Verify response status
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);

  // Validate response data
  const data = await response.json();
  expect(data).toHaveProperty('email');
  expect(data).toHaveProperty('name');
});`,
  },
  {
    id: "pw-api-validation",
    name: "API Response Validation",
    description: "Comprehensive API response validation",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "validation"],
    code: `import { test, expect } from '@playwright/test';

test('comprehensive API validation', async ({ request }) => {
  // Make GET request
  const response = await request.get('https://jsonplaceholder.typicode.com/users/1');

  // Status validation
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);

  // Headers validation
  expect(response.headers()['content-type']).toContain('application/json');

  // Response body validation
  const data = await response.json();
  expect(data).toHaveProperty('id', 1);
  expect(data).toHaveProperty('name');
  expect(data).toHaveProperty('email');
  // Validate email format
  expect(data.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);

  // Nested object validation
  expect(data).toHaveProperty('address');
  expect(data.address).toHaveProperty('city');
  expect(data.address).toHaveProperty('zipcode');
});`,
  },
  {
    id: "pw-auth-test",
    name: "Authentication Test",
    description: "Test login and authentication flow",
    category: "Authentication",
    testType: "browser",
    tags: ["playwright", "auth", "login"],
    code: `import { test, expect } from '@playwright/test';

test('user login test', async ({ page }) => {
  // Navigate to login page
  await page.goto('https://example.com/login');

  // Fill in login credentials
  await page.getByLabel('Username').fill('testuser');
  await page.getByLabel('Password').fill('password123');

  // Click login button
  await page.getByRole('button', { name: 'Login' }).click();

  // Wait for navigation to dashboard
  await page.waitForURL('**/dashboard');

  // Verify user is logged in
  await expect(page.getByText('Welcome, testuser')).toBeVisible();

  // Verify logout button is present
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
});`,
  },
  {
    id: "pw-database-select",
    name: "Database SELECT Query",
    description: "Test database SELECT operations",
    category: "Database Testing",
    testType: "database",
    tags: ["playwright", "database", "select"],
    code: `import { test, expect } from '@playwright/test';
import { Pool } from 'pg';

// Database connection configuration
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('database SELECT query', async () => {
  // Execute SELECT query
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [1]);

  // Verify query results
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toHaveProperty('id', 1);
  expect(result.rows[0]).toHaveProperty('email');
  expect(result.rows[0]).toHaveProperty('name');
});

// Cleanup after all tests
test.afterAll(async () => {
  await pool.end();
});`,
  },
  {
    id: "pw-database-insert",
    name: "Database INSERT Operation",
    description: "Test database INSERT operations",
    category: "Database Testing",
    testType: "database",
    tags: ["playwright", "database", "insert"],
    code: `import { test, expect } from '@playwright/test';
import { Pool } from 'pg';

// Database connection configuration
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('database INSERT operation', async () => {
  // Execute INSERT with RETURNING clause
  const result = await pool.query(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
    ['Test User', 'test@example.com']
  );

  // Verify insert succeeded
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].name).toBe('Test User');
  expect(result.rows[0].email).toBe('test@example.com');
  expect(result.rows[0]).toHaveProperty('id');
});

// Cleanup after all tests
test.afterAll(async () => {
  await pool.end();
});`,
  },
  {
    id: "pw-database-update",
    name: "Database UPDATE Operation",
    description: "Test database UPDATE operations",
    category: "Database Testing",
    testType: "database",
    tags: ["playwright", "database", "update"],
    code: `import { test, expect } from '@playwright/test';
import { Pool } from 'pg';

// Database connection configuration
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('database UPDATE operation', async () => {
  // Execute UPDATE with RETURNING clause
  const result = await pool.query(
    'UPDATE users SET name = $1 WHERE id = $2 RETURNING *',
    ['Updated Name', 1]
  );

  // Verify update succeeded
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].id).toBe(1);
  expect(result.rows[0].name).toBe('Updated Name');
});

// Cleanup after all tests
test.afterAll(async () => {
  await pool.end();
});`,
  },
  {
    id: "pw-database-delete",
    name: "Database DELETE Operation",
    description: "Test database DELETE operations",
    category: "Database Testing",
    testType: "database",
    tags: ["playwright", "database", "delete"],
    code: `import { test, expect } from '@playwright/test';
import { Pool } from 'pg';

// Database connection configuration
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('database DELETE operation', async () => {
  // Execute DELETE with RETURNING clause
  const result = await pool.query(
    'DELETE FROM users WHERE id = $1 RETURNING *',
    [1]
  );

  // Verify deletion succeeded
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].id).toBe(1);

  // Verify record no longer exists
  const verifyResult = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [1]
  );

  expect(verifyResult.rows).toHaveLength(0);
});

// Cleanup after all tests
test.afterAll(async () => {
  await pool.end();
});`,
  },
  {
    id: "pw-database-transaction",
    name: "Database Transaction",
    description: "Test database transactions with rollback",
    category: "Database Testing",
    testType: "database",
    tags: ["playwright", "database", "transaction"],
    code: `import { test, expect } from '@playwright/test';
import { Pool } from 'pg';

// Database connection configuration
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('database transaction with rollback', async () => {
  // Get a client from the pool
  const client = await pool.connect();

  try {
    // Begin transaction
    await client.query('BEGIN');

    // Insert data within transaction
    await client.query(
      'INSERT INTO users (name, email) VALUES ($1, $2)',
      ['Transaction User', 'transaction@example.com']
    );

    // Verify insert within transaction
    const result = await client.query(
      'SELECT * FROM users WHERE email = $1',
      ['transaction@example.com']
    );
    expect(result.rows).toHaveLength(1);

    // Rollback transaction
    await client.query('ROLLBACK');

    // Verify rollback - record should not exist
    const verifyResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      ['transaction@example.com']
    );
    expect(verifyResult.rows).toHaveLength(0);
  } finally {
    // Release client back to pool
    client.release();
  }
});

// Cleanup after all tests
test.afterAll(async () => {
  await pool.end();
});`,
  },
  {
    id: "pw-mobile-test",
    name: "Mobile Browser Test",
    description: "Test responsive design on mobile devices",
    category: "Mobile Testing",
    testType: "browser",
    tags: ["playwright", "mobile", "responsive"],
    code: `import { test, expect, devices } from '@playwright/test';

// Configure test to use iPhone 13 viewport
test.use({
  ...devices['iPhone 13'],
});

test('mobile responsive test', async ({ page }) => {
  // Navigate to the page
  await page.goto('https://example.com');

  // Verify mobile menu is visible
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();

  // Click hamburger menu
  await page.getByRole('button', { name: 'Menu' }).click();

  // Verify navigation menu appears
  await expect(page.getByRole('navigation')).toBeVisible();

  // Test viewport dimensions
  const viewport = page.viewportSize();
  expect(viewport?.width).toBe(390);
  expect(viewport?.height).toBe(844);
});`,
  },
  {
    id: "pw-screenshot-test",
    name: "Visual Regression Test",
    description: "Capture and compare screenshots",
    category: "Visual Testing",
    testType: "browser",
    tags: ["playwright", "visual", "screenshot"],
    code: `import { test, expect } from '@playwright/test';

test('visual regression test', async ({ page }) => {
  // Navigate to the page
  await page.goto('https://example.com');

  // Wait for page to be fully loaded
  await page.waitForLoadState('networkidle');

  // Take full page screenshot and compare
  await expect(page).toHaveScreenshot('homepage.png', {
    fullPage: true,
  });

  // Take screenshot of specific element
  const header = page.locator('header');
  await expect(header).toHaveScreenshot('header.png');

  // Screenshot with custom options
  await page.screenshot({
    path: 'page-with-scroll.png',
    fullPage: true,
  });
});`,
  },
  {
    id: "pw-file-upload",
    name: "File Upload Test",
    description: "Test file upload functionality",
    category: "File Operations",
    testType: "browser",
    tags: ["playwright", "upload", "files"],
    code: `import { test, expect } from '@playwright/test';
import path from 'path';

test('file upload test', async ({ page }) => {
  // Navigate to upload page
  await page.goto('https://example.com/upload');

  // Prepare file path
  const filePath = path.join(__dirname, 'test-file.txt');

  // Upload file using file input
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);

  // Verify file name is displayed
  await expect(page.getByText('test-file.txt')).toBeVisible();

  // Click upload button
  await page.getByRole('button', { name: 'Upload' }).click();

  // Verify upload success
  await expect(page.getByText('File uploaded successfully')).toBeVisible();
});`,
  },
  {
    id: "pw-custom-script",
    name: "Custom Test Script",
    description: "Blank template for custom test logic",
    category: "Custom",
    testType: "custom",
    tags: ["playwright", "custom"],
    code: `import { test, expect } from '@playwright/test';

test('custom test', async ({ page }) => {
  // Navigate to your application
  await page.goto('https://example.com');

  // Add your custom test steps here

});`,
  },
];

// Helper function to get templates by test type
export function getTemplatesByType(testType: TestType): CodeTemplate[] {
  if (testType === "performance") {
    return codeTemplates.filter((t) => t.testType === "performance");
  }

  // For custom type, return all Playwright templates
  if (testType === "custom") {
    return codeTemplates.filter((t) => t.testType !== "performance");
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
