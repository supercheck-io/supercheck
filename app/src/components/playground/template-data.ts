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
    code: `import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
};

export default function() {
  const res = http.get('https://test-api.k6.io/public/crocodiles/');

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

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
    code: `import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 100 }, // Fast ramp-up to high load
    { duration: '1m', target: 100 },  // Stay at high load
    { duration: '10s', target: 0 },   // Quick ramp-down
  ],
};

export default function() {
  const res = http.get('https://test-api.k6.io/public/crocodiles/');

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

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
    code: `import http from 'k6/http';
import { sleep, check } from 'k6';

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
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    http_req_failed: ['rate<0.01'],   // Error rate should be below 1%
  },
};

export default function() {
  const res = http.get('https://test-api.k6.io/public/crocodiles/');

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

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
    code: `import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '5m', target: 50 },  // Ramp up
    { duration: '2h', target: 50 },  // Stay at load for 2 hours
    { duration: '5m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function() {
  const res = http.get('https://test-api.k6.io/public/crocodiles/');

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

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
    code: `import http from 'k6/http';
import { check, group } from 'k6';

export const options = {
  vus: 20,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function() {
  const baseUrl = 'https://test-api.k6.io';

  group('API Tests', function() {
    // GET request
    group('GET /crocodiles', function() {
      const res = http.get(\`\${baseUrl}/public/crocodiles/\`);
      check(res, {
        'GET status is 200': (r) => r.status === 200,
        'GET has crocodiles': (r) => JSON.parse(r.body).length > 0,
      });
    });

    // POST request
    group('POST /crocodile', function() {
      const payload = JSON.stringify({
        name: 'Test Croc',
        sex: 'M',
        date_of_birth: '2020-01-01',
      });

      const params = {
        headers: {
          'Content-Type': 'application/json',
        },
      };

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
    code: `import { browser } from 'k6/experimental/browser';
import { check } from 'k6';

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
  thresholds: {
    checks: ['rate==1.0'],
  },
};

export default async function() {
  const page = browser.newPage();

  try {
    await page.goto('https://test.k6.io/');

    check(page, {
      'page loaded': page.locator('h1').textContent() !== '',
    });

    // Measure page load time
    const performanceTiming = page.evaluate(() => {
      return JSON.stringify(window.performance.timing);
    });

    console.log('Performance timing:', performanceTiming);
  } finally {
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
    code: `import { test, expect } from '@playwright/test';

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
  const response = await request.get('https://jsonplaceholder.typicode.com/posts/1');

  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);

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
  const response = await request.post('https://jsonplaceholder.typicode.com/posts', {
    data: {
      title: 'Test Post',
      body: 'This is a test post',
      userId: 1,
    },
  });

  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(201);

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
  const response = await request.put('https://jsonplaceholder.typicode.com/posts/1', {
    data: {
      id: 1,
      title: 'Updated Title',
      body: 'Updated body content',
      userId: 1,
    },
  });

  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);

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
  const response = await request.delete('https://jsonplaceholder.typicode.com/posts/1');

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
  const response = await request.get('https://api.example.com/user/profile', {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN_HERE',
      'Content-Type': 'application/json',
    },
  });

  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);

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
  await page.goto('https://example.com/login');

  // Fill in login credentials
  await page.getByLabel('Username').fill('testuser');
  await page.getByLabel('Password').fill('password123');

  // Click login button
  await page.getByRole('button', { name: 'Login' }).click();

  // Wait for navigation
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

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('database SELECT query', async () => {
  // Test SELECT query
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [1]);

  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toHaveProperty('id', 1);
  expect(result.rows[0]).toHaveProperty('email');
  expect(result.rows[0]).toHaveProperty('name');
});

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

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('database INSERT operation', async () => {
  // Test INSERT
  const result = await pool.query(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
    ['Test User', 'test@example.com']
  );

  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].name).toBe('Test User');
  expect(result.rows[0].email).toBe('test@example.com');
  expect(result.rows[0]).toHaveProperty('id');
});

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

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('database UPDATE operation', async () => {
  // Test UPDATE
  const result = await pool.query(
    'UPDATE users SET name = $1 WHERE id = $2 RETURNING *',
    ['Updated Name', 1]
  );

  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].id).toBe(1);
  expect(result.rows[0].name).toBe('Updated Name');
});

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

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('database DELETE operation', async () => {
  // Test DELETE
  const result = await pool.query(
    'DELETE FROM users WHERE id = $1 RETURNING *',
    [1]
  );

  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].id).toBe(1);

  // Verify deletion
  const verifyResult = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [1]
  );

  expect(verifyResult.rows).toHaveLength(0);
});

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

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('database transaction with rollback', async () => {
  const client = await pool.connect();

  try {
    // Begin transaction
    await client.query('BEGIN');

    // Insert data
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

    // Verify rollback
    const verifyResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      ['transaction@example.com']
    );
    expect(verifyResult.rows).toHaveLength(0);
  } finally {
    client.release();
  }
});

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

test.use({
  ...devices['iPhone 13'],
});

test('mobile responsive test', async ({ page }) => {
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
  await page.goto('https://example.com');

  // Wait for page to be fully loaded
  await page.waitForLoadState('networkidle');

  // Take full page screenshot
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
  // Your custom test logic here
  await page.goto('https://example.com');

  // Add your test steps

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
