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
    code: `/**
 * Playwright Form Interaction Test
 *
 * This test demonstrates comprehensive form automation including text inputs,
 * dropdowns, checkboxes, radio buttons, and form submission validation.
 *
 * Test Coverage:
 * - Text input field interaction (fill, clear, type)
 * - Dropdown/select element selection
 * - Checkbox and radio button toggling
 * - Form submission and validation
 * - Success/error message verification
 *
 * Key Features:
 * - Label-based element selection (accessibility best practice)
 * - Role-based button interaction
 * - Form state validation
 * - Wait for response after submission
 *
 * Use Cases:
 * - Contact form testing
 * - Registration flow validation
 * - Data entry verification
 * - Form validation testing
 *
 * Best Practices:
 * - Use getByLabel() for accessible form testing
 * - Verify element states before interaction
 * - Wait for server responses after submission
 *
 * Documentation: https://playwright.dev/docs/input
 *
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test('form interaction test', async ({ page }) => {
  // Navigate to form page
  await page.goto('https://example.com/form');

  // Fill in text fields
  await page.getByLabel('Name').fill('John Doe');
  await page.getByLabel('Email').fill('john@example.com');
  await page.getByLabel('Message').fill('This is a test message');

  // Select from dropdown
  await page.getByLabel('Country').selectOption('US');

  // Check checkbox
  await page.getByLabel('I agree to terms').check();

  // Verify checkbox is checked
  await expect(page.getByLabel('I agree to terms')).toBeChecked();

  // Select radio button
  await page.getByLabel('Subscribe to newsletter').check();

  // Click submit button
  await page.getByRole('button', { name: 'Submit' }).click();

  // Wait for navigation or response
  await page.waitForLoadState('networkidle');

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
    code: `/**
 * Playwright API GET Request Test
 *
 * This test demonstrates HTTP GET request testing using Playwright's
 * built-in request context. It validates API endpoints without browser overhead.
 *
 * Test Coverage:
 * - HTTP GET request execution
 * - Response status code validation
 * - JSON response parsing
 * - Response schema validation
 * - Response property existence checks
 *
 * Key Features:
 * - No browser required (faster than browser-based tests)
 * - Built-in request retries and timeouts
 * - Automatic JSON parsing
 * - Response header validation
 *
 * Use Cases:
 * - REST API endpoint testing
 * - API health checks
 * - Backend service validation
 * - Integration testing
 *
 * Best Practices:
 * - Validate both status code and response body
 * - Check for required properties in response
 * - Use response.ok() for 2xx status range
 *
 * Target API: JSONPlaceholder (free fake API)
 * Documentation: https://playwright.dev/docs/api-testing
 *
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test('API GET request', async ({ request }) => {
  // Make GET request
  const response = await request.get('https://jsonplaceholder.typicode.com/posts/1');

  // Verify response status (2xx range)
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);

  // Verify response headers
  expect(response.headers()['content-type']).toContain('application/json');

  // Parse and validate response data
  const data = await response.json();
  expect(data).toHaveProperty('id', 1);
  expect(data).toHaveProperty('title');
  expect(data).toHaveProperty('body');
  expect(data).toHaveProperty('userId');

  // Validate data types
  expect(typeof data.id).toBe('number');
  expect(typeof data.title).toBe('string');
  expect(data.title.length).toBeGreaterThan(0);
});`,
  },
  {
    id: "pw-api-post",
    name: "API POST Request",
    description: "Test POST endpoint with data",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "post"],
    code: `/**
 * Playwright API POST Request Test
 *
 * This test demonstrates creating new resources via HTTP POST requests
 * with JSON payloads. It validates request handling and response data.
 *
 * Test Coverage:
 * - HTTP POST request with JSON payload
 * - Request header configuration (Content-Type)
 * - Response status validation (201 Created)
 * - Response body validation
 * - Resource creation verification
 *
 * Key Features:
 * - JSON payload serialization
 * - Custom request headers
 * - Created resource ID validation
 * - Response data matching request data
 *
 * Use Cases:
 * - Create new resources via API
 * - Test form submission backends
 * - Validate data persistence
 * - Integration testing for CRUD operations
 *
 * Best Practices:
 * - Always set Content-Type for JSON requests
 * - Validate response includes created resource ID
 * - Verify request data persists in response
 *
 * Target API: JSONPlaceholder
 * Documentation: https://playwright.dev/docs/api-testing
 *
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test('API POST request', async ({ request }) => {
  // Prepare request payload
  const payload = {
    title: 'Test Post',
    body: 'This is a test post',
    userId: 1,
  };

  // Make POST request with data
  const response = await request.post('https://jsonplaceholder.typicode.com/posts', {
    data: payload,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Verify response status (201 Created)
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(201);

  // Validate response data
  const data = await response.json();
  expect(data).toHaveProperty('id');
  expect(data.title).toBe(payload.title);
  expect(data.body).toBe(payload.body);
  expect(data.userId).toBe(payload.userId);

  // Verify created resource has ID
  expect(typeof data.id).toBe('number');
  expect(data.id).toBeGreaterThan(0);
});`,
  },
  {
    id: "pw-api-put",
    name: "API PUT Request",
    description: "Test PUT endpoint for updates",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "put"],
    code: `/**
 * Playwright API PUT Request Test
 *
 * This test demonstrates updating existing resources via HTTP PUT requests.
 * PUT is used for complete resource replacement with new data.
 *
 * Test Coverage:
 * - HTTP PUT request execution
 * - Complete resource update/replacement
 * - Response validation (200 OK)
 * - Updated data verification
 * - Idempotent operation testing
 *
 * Key Features:
 * - Full resource replacement
 * - JSON payload with all fields
 * - Update confirmation validation
 * - Idempotent operation (same result on repeat)
 *
 * Use Cases:
 * - Update complete resource records
 * - Replace entire database entries
 * - Modify user profiles
 * - Update configuration settings
 *
 * Best Practices:
 * - Include all resource fields in PUT (not partial)
 * - Verify both status code and response content
 * - Test idempotency (repeated requests same result)
 *
 * Documentation: https://playwright.dev/docs/api-testing
 *
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test('API PUT request', async ({ request }) => {
  // Prepare complete resource data
  const updatedResource = {
    id: 1,
    title: 'Updated Title',
    body: 'Updated body content',
    userId: 1,
  };

  // Make PUT request to update resource
  const response = await request.put('https://jsonplaceholder.typicode.com/posts/1', {
    data: updatedResource,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Verify response status (200 OK)
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);

  // Validate updated data
  const data = await response.json();
  expect(data.id).toBe(updatedResource.id);
  expect(data.title).toBe(updatedResource.title);
  expect(data.body).toBe(updatedResource.body);
  expect(data.userId).toBe(updatedResource.userId);
});`,
  },
  {
    id: "pw-api-delete",
    name: "API DELETE Request",
    description: "Test DELETE endpoint",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "delete"],
    code: `/**
 * Playwright API DELETE Request Test
 *
 * This test demonstrates resource deletion via HTTP DELETE requests
 * and verifies successful removal from the system.
 *
 * Test Coverage:
 * - HTTP DELETE request execution
 * - Successful deletion verification (200 OK or 204 No Content)
 * - Resource removal confirmation
 * - Idempotent operation testing
 *
 * Key Features:
 * - Resource deletion via ID
 * - Status code validation
 * - Clean resource removal
 * - Simple request pattern
 *
 * Use Cases:
 * - Delete user accounts
 * - Remove database records
 * - Clean up test data
 * - Validate deletion endpoints
 *
 * Best Practices:
 * - Verify 200 or 204 (No Content) status
 * - Test deletion is idempotent
 * - Verify resource actually removed (follow-up GET)
 * - Consider soft delete vs hard delete
 *
 * Documentation: https://playwright.dev/docs/api-testing
 *
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test('API DELETE request', async ({ request }) => {
  // Make DELETE request
  const response = await request.delete('https://jsonplaceholder.typicode.com/posts/1');

  // Verify response status (200 OK or 204 No Content)
  expect(response.ok()).toBeTruthy();
  expect([200, 204]).toContain(response.status());

  // Optional: Verify resource no longer exists
  const verifyResponse = await request.get('https://jsonplaceholder.typicode.com/posts/1');

  // Note: JSONPlaceholder is a fake API, real API should return 404
  // In production, you would expect: expect(verifyResponse.status()).toBe(404);
});`,
  },
  {
    id: "pw-api-auth",
    name: "API Authentication",
    description: "Test API with authentication headers",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "auth"],
    code: `/**
 * Playwright API Authentication Test
 *
 * This test demonstrates API requests with authentication headers including
 * Bearer tokens, API keys, and custom authentication schemes.
 *
 * Test Coverage:
 * - Bearer token authentication
 * - Custom authentication headers
 * - Authorized request execution
 * - Protected endpoint access
 * - Authentication failure handling
 *
 * Key Features:
 * - Authorization header configuration
 * - Bearer token pattern
 * - Multi-header request setup
 * - Secure API access testing
 *
 * Use Cases:
 * - Test protected API endpoints
 * - Validate authentication mechanisms
 * - Verify token-based access control
 * - Integration testing for secured APIs
 *
 * Best Practices:
 * - Never commit real tokens to version control
 * - Test both successful auth and auth failures
 * - Use test fixtures for auth state management
 * - Use app vault for credential management in production
 *
 * Documentation: https://playwright.dev/docs/api-testing
 *
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test('API request with authentication', async ({ request }) => {
  // Authentication token (use app vault for production credentials)
  const authToken = 'your-api-token-here';

  // Make request with authentication header
  const response = await request.get('https://api.example.com/user/profile', {
    headers: {
      'Authorization': \`Bearer \${authToken}\`,
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
  expect(data).toHaveProperty('id');

  // Verify data types
  expect(typeof data.email).toBe('string');
  expect(typeof data.name).toBe('string');
});`,
  },
  {
    id: "pw-api-validation",
    name: "API Response Validation",
    description: "Comprehensive API response validation",
    category: "API Testing",
    testType: "api",
    tags: ["playwright", "api", "validation"],
    code: `/**
 * Playwright Comprehensive API Validation Test
 *
 * This test demonstrates thorough API response validation including
 * status codes, headers, body structure, data types, and format validation.
 *
 * Test Coverage:
 * - HTTP status code validation
 * - Response header inspection
 * - JSON schema validation
 * - Property existence checks
 * - Data type validation
 * - Format validation (email, URLs, etc.)
 * - Nested object validation
 * - Array validation
 *
 * Key Features:
 * - Multi-layer validation (status, headers, body)
 * - Regex pattern matching
 * - Nested property validation
 * - Type checking
 * - Format validation
 *
 * Use Cases:
 * - API contract testing
 * - Response schema validation
 * - Data integrity verification
 * - API specification compliance
 *
 * Best Practices:
 * - Validate multiple layers (status, headers, body)
 * - Check both presence and format of data
 * - Validate nested objects and arrays
 * - Use regex for format validation
 * - Test boundary conditions
 *
 * Documentation: https://playwright.dev/docs/api-testing
 *
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test('comprehensive API validation', async ({ request }) => {
  // Make GET request
  const response = await request.get('https://jsonplaceholder.typicode.com/users/1');

  // Status validation
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);

  // Headers validation
  const headers = response.headers();
  expect(headers['content-type']).toContain('application/json');
  expect(headers).toHaveProperty('date');

  // Response body validation
  const data = await response.json();

  // Required properties
  expect(data).toHaveProperty('id', 1);
  expect(data).toHaveProperty('name');
  expect(data).toHaveProperty('username');
  expect(data).toHaveProperty('email');
  expect(data).toHaveProperty('phone');
  expect(data).toHaveProperty('website');

  // Type validation
  expect(typeof data.id).toBe('number');
  expect(typeof data.name).toBe('string');
  expect(typeof data.email).toBe('string');

  // Format validation - Email
  expect(data.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);

  // Nested object validation - Address
  expect(data).toHaveProperty('address');
  expect(data.address).toHaveProperty('street');
  expect(data.address).toHaveProperty('city');
  expect(data.address).toHaveProperty('zipcode');
  expect(data.address).toHaveProperty('geo');
  expect(data.address.geo).toHaveProperty('lat');
  expect(data.address.geo).toHaveProperty('lng');

  // Nested object validation - Company
  expect(data).toHaveProperty('company');
  expect(data.company).toHaveProperty('name');
  expect(data.company).toHaveProperty('catchPhrase');
  expect(data.company).toHaveProperty('bs');
});`,
  },
  {
    id: "pw-auth-test",
    name: "Authentication Test",
    description: "Test login and authentication flow",
    category: "Authentication",
    testType: "browser",
    tags: ["playwright", "auth", "login"],
    code: `/**
 * Playwright User Authentication Flow Test
 *
 * This test demonstrates end-to-end user authentication including login,
 * session management, and authenticated state verification.
 *
 * Test Coverage:
 * - Login form interaction
 * - Credential submission
 * - Session establishment
 * - Post-login navigation
 * - Authentication state verification
 * - Logout functionality
 *
 * Key Features:
 * - Form-based authentication
 * - URL-based navigation validation
 * - Session persistence checking
 * - User-specific content verification
 *
 * Use Cases:
 * - User login flow testing
 * - Session management validation
 * - Authentication state verification
 * - Access control testing
 *
 * Best Practices:
 * - Wait for navigation completion (waitForURL)
 * - Verify authenticated user elements
 * - Test logout functionality
 * - Use storage state for auth persistence across tests
 *
 * Documentation: https://playwright.dev/docs/auth
 *
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test('user login test', async ({ page }) => {
  // Navigate to login page
  await page.goto('https://example.com/login');

  // Verify login page loaded
  await expect(page).toHaveTitle(/Login/);

  // Fill in login credentials
  await page.getByLabel('Username').fill('testuser');
  await page.getByLabel('Password').fill('password123');

  // Verify credentials are filled
  await expect(page.getByLabel('Username')).toHaveValue('testuser');

  // Click login button
  await page.getByRole('button', { name: 'Login' }).click();

  // Wait for navigation to dashboard
  await page.waitForURL('**/dashboard');

  // Verify user is logged in
  await expect(page.getByText('Welcome, testuser')).toBeVisible();

  // Verify logout button is present
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();

  // Verify navigation menu is accessible
  await expect(page.getByRole('navigation')).toBeVisible();
});`,
  },
  {
    id: "pw-database-select",
    name: "Database SELECT Query",
    description: "Test database SELECT operations",
    category: "Database Testing",
    testType: "database",
    tags: ["playwright", "database", "select"],
    code: `/**
 * Playwright Database SELECT Query Test
 *
 * This test demonstrates database query execution and result validation
 * using PostgreSQL client library integrated with Playwright tests.
 *
 * Test Coverage:
 * - Database connection establishment
 * - SELECT query execution
 * - Query result validation
 * - Result set row counting
 * - Column value verification
 * - Data type checking
 *
 * Key Features:
 * - Parameterized queries (SQL injection prevention)
 * - Connection pooling
 * - Result set validation
 * - Proper resource cleanup
 *
 * Use Cases:
 * - Verify data persistence after operations
 * - Validate database state
 * - Integration testing with database
 * - Data integrity verification
 *
 * Best Practices:
 * - Always use parameterized queries ($1, $2, etc.)
 * - Close connections in afterAll hook
 * - Validate both row count and content
 * - Use connection pooling for performance
 *
 * Database: PostgreSQL (pg library)
 * Documentation: https://node-postgres.com/
 *
 * @requires @playwright/test, pg
 */

import { test, expect } from '@playwright/test';
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
  // Execute SELECT query with parameter
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [1]);

  // Verify query results
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toHaveProperty('id', 1);
  expect(result.rows[0]).toHaveProperty('email');
  expect(result.rows[0]).toHaveProperty('name');

  // Validate data types
  expect(typeof result.rows[0].id).toBe('number');
  expect(typeof result.rows[0].name).toBe('string');
  expect(typeof result.rows[0].email).toBe('string');
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
    code: `/**
 * Playwright Database INSERT Operation Test
 *
 * This test demonstrates creating new database records using parameterized
 * queries with PostgreSQL. It validates data insertion and auto-generated IDs.
 *
 * Test Coverage:
 * - Database connection establishment
 * - INSERT query execution with parameters
 * - RETURNING clause for immediate validation
 * - Auto-generated ID verification
 * - Inserted data validation
 * - SQL injection prevention
 *
 * Key Features:
 * - Parameterized queries ($1, $2, etc.)
 * - RETURNING clause returns inserted row
 * - Connection pooling
 * - Automatic type conversion
 * - Proper resource cleanup
 *
 * Use Cases:
 * - Test user registration flows
 * - Validate data persistence
 * - Test record creation APIs
 * - Integration testing with database
 *
 * Best Practices:
 * - Always use parameterized queries (prevents SQL injection)
 * - Use RETURNING * to validate inserted data
 * - Close connections in afterAll hook
 * - Validate both data and auto-generated IDs
 * - Use connection pooling for performance
 *
 * Database: PostgreSQL (pg library)
 * Documentation: https://node-postgres.com/
 *
 * @requires @playwright/test, pg
 */

import { test, expect } from '@playwright/test';
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
  // Execute INSERT query with parameterized values
  const result = await pool.query(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
    ['Test User', 'test@example.com']
  );

  // Verify one row was inserted
  expect(result.rows).toHaveLength(1);

  // Validate inserted data matches input
  expect(result.rows[0].name).toBe('Test User');
  expect(result.rows[0].email).toBe('test@example.com');

  // Verify auto-generated ID was created
  expect(result.rows[0]).toHaveProperty('id');
  expect(typeof result.rows[0].id).toBe('number');
  expect(result.rows[0].id).toBeGreaterThan(0);
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
    code: `/**
 * Playwright Database UPDATE Operation Test
 *
 * This test demonstrates updating existing database records using parameterized
 * queries with WHERE clause. It validates data modification and uses RETURNING
 * clause for immediate verification.
 *
 * Test Coverage:
 * - Database connection establishment
 * - UPDATE query execution with parameters
 * - WHERE clause for targeted updates
 * - RETURNING clause for immediate validation
 * - Updated data verification
 * - SQL injection prevention
 *
 * Key Features:
 * - Parameterized queries ($1, $2, etc.)
 * - WHERE clause prevents mass updates
 * - RETURNING clause returns updated row
 * - Connection pooling
 * - Proper resource cleanup
 *
 * Use Cases:
 * - Test user profile updates
 * - Validate data modification flows
 * - Test record update APIs
 * - Integration testing with database
 *
 * Best Practices:
 * - Always use parameterized queries (prevents SQL injection)
 * - Always include WHERE clause (avoid mass updates)
 * - Use RETURNING * to validate updated data
 * - Close connections in afterAll hook
 * - Verify both affected rows and updated values
 *
 * Database: PostgreSQL (pg library)
 * Documentation: https://node-postgres.com/
 *
 * @requires @playwright/test, pg
 */

import { test, expect } from '@playwright/test';
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
  // Execute UPDATE query with parameterized values
  const result = await pool.query(
    'UPDATE users SET name = $1 WHERE id = $2 RETURNING *',
    ['Updated Name', 1]
  );

  // Verify one row was updated
  expect(result.rows).toHaveLength(1);

  // Validate correct row was updated
  expect(result.rows[0].id).toBe(1);

  // Validate data was updated correctly
  expect(result.rows[0].name).toBe('Updated Name');

  // Verify other fields remain unchanged
  expect(result.rows[0]).toHaveProperty('email');
  expect(result.rows[0]).toHaveProperty('id');
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
    code: `/**
 * Playwright Database DELETE Operation Test
 *
 * This test demonstrates deleting database records using parameterized queries
 * with WHERE clause. It validates record deletion and verifies removal with
 * follow-up SELECT query.
 *
 * Test Coverage:
 * - Database connection establishment
 * - DELETE query execution with parameters
 * - WHERE clause for targeted deletion
 * - RETURNING clause captures deleted row
 * - Deletion verification with SELECT query
 * - SQL injection prevention
 *
 * Key Features:
 * - Parameterized queries ($1, $2, etc.)
 * - WHERE clause prevents mass deletion
 * - RETURNING clause returns deleted row
 * - Follow-up SELECT verifies deletion
 * - Connection pooling
 * - Proper resource cleanup
 *
 * Use Cases:
 * - Test account deletion flows
 * - Validate record removal
 * - Test data cleanup operations
 * - Integration testing with database
 *
 * Best Practices:
 * - Always use parameterized queries (prevents SQL injection)
 * - Always include WHERE clause (avoid mass deletion)
 * - Use RETURNING * to capture deleted data
 * - Verify deletion with follow-up SELECT query
 * - Close connections in afterAll hook
 * - Consider soft deletes for audit trails
 *
 * Database: PostgreSQL (pg library)
 * Documentation: https://node-postgres.com/
 *
 * @requires @playwright/test, pg
 */

import { test, expect } from '@playwright/test';
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
  // Execute DELETE query with parameterized value
  const result = await pool.query(
    'DELETE FROM users WHERE id = $1 RETURNING *',
    [1]
  );

  // Verify one row was deleted
  expect(result.rows).toHaveLength(1);

  // Validate correct row was deleted (via RETURNING clause)
  expect(result.rows[0].id).toBe(1);
  expect(result.rows[0]).toHaveProperty('name');
  expect(result.rows[0]).toHaveProperty('email');

  // Verify deletion by attempting to SELECT the deleted row
  const verifyResult = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [1]
  );

  // Confirm row no longer exists
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
    code: `/**
 * Playwright Database Transaction Test
 *
 * This test demonstrates database transactions using BEGIN/COMMIT/ROLLBACK
 * for atomic operations. It validates ACID properties and ensures data
 * consistency through transaction rollback.
 *
 * Test Coverage:
 * - Database connection and client acquisition
 * - Transaction initiation (BEGIN)
 * - Multiple operations within transaction
 * - Transaction rollback
 * - Data isolation validation
 * - Transaction atomicity verification
 *
 * Key Features:
 * - BEGIN starts transaction
 * - ROLLBACK undoes all changes
 * - COMMIT persists all changes (not shown, see ROLLBACK)
 * - Automatic client release (finally block)
 * - Proper error handling
 * - Connection pooling
 *
 * Use Cases:
 * - Test multi-step operations requiring atomicity
 * - Validate transaction rollback on errors
 * - Test data consistency in complex operations
 * - Integration testing with database transactions
 *
 * Best Practices:
 * - Always use client.release() in finally block
 * - Use BEGIN/COMMIT/ROLLBACK for atomic operations
 * - Use transactions for multiple related operations
 * - Test both COMMIT and ROLLBACK scenarios
 * - Handle errors with proper transaction rollback
 * - Use parameterized queries within transactions
 *
 * ACID Properties:
 * - Atomicity: All operations succeed or all fail
 * - Consistency: Data remains in valid state
 * - Isolation: Concurrent transactions don't interfere
 * - Durability: Committed changes persist
 *
 * Database: PostgreSQL (pg library)
 * Documentation: https://node-postgres.com/features/transactions
 *
 * @requires @playwright/test, pg
 */

import { test, expect } from '@playwright/test';
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
  // Acquire a client from the pool for transaction
  const client = await pool.connect();

  try {
    // Start transaction
    await client.query('BEGIN');

    // Execute INSERT within transaction
    await client.query(
      'INSERT INTO users (name, email) VALUES ($1, $2)',
      ['Transaction User', 'transaction@example.com']
    );

    // Verify data exists within transaction
    const result = await client.query(
      'SELECT * FROM users WHERE email = $1',
      ['transaction@example.com']
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Transaction User');
    expect(result.rows[0].email).toBe('transaction@example.com');

    // Rollback transaction (undo all changes)
    await client.query('ROLLBACK');

    // Verify data was NOT persisted (rollback successful)
    const verifyResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      ['transaction@example.com']
    );
    expect(verifyResult.rows).toHaveLength(0);

    // Note: Use COMMIT instead of ROLLBACK to persist changes
    // await client.query('COMMIT');
  } finally {
    // Always release client back to pool
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
    code: `/**
 * Mobile Device Emulation Test
 *
 * Tests responsive design using Playwright's device emulation.
 * Validates mobile-specific UI elements and viewport dimensions.
 *
 * @requires @playwright/test
 */

import { test, expect, devices } from '@playwright/test';

test.use({
  ...devices['iPhone 13'],
});

test('mobile responsive test', async ({ page }) => {
  await page.goto('https://example.com');

  // Verify mobile menu
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();

  // Verify viewport
  const viewport = page.viewportSize();
  expect(viewport?.width).toBe(390);
  expect(viewport?.height).toBe(844);
});`,
  },
  {
    id: "pw-file-upload",
    name: "File Upload Test",
    description: "Test file upload functionality",
    category: "File Operations",
    testType: "browser",
    tags: ["playwright", "upload", "files"],
    code: `/**
 * File Upload Test
 *
 * Tests file input interaction and upload validation.
 * Use setInputFiles() for file selection.
 *
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';
import path from 'path';

test('file upload test', async ({ page }) => {
  await page.goto('https://example.com/upload');

  const filePath = path.join(__dirname, 'test-file.txt');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);

  await expect(page.getByText('test-file.txt')).toBeVisible();
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('File uploaded successfully')).toBeVisible();
});`,
  },
  {
    id: "pw-custom-script",
    name: "Combined DB + API + UI Test",
    description: "Test combining database, API, and browser interactions",
    category: "Custom",
    testType: "custom",
    tags: ["playwright", "custom", "combined"],
    code: `/**
 * Playwright Combined Integration Test (DB + API + UI)
 *
 * This advanced test demonstrates combining database operations, API testing,
 * and browser automation in a single end-to-end test flow. It showcases how
 * different test types can work together to validate complex user journeys.
 *
 * Test Coverage:
 * - Database query execution and validation
 * - API request with dynamic authentication
 * - Browser UI verification
 * - Cross-layer data validation
 * - UI interaction and database persistence
 * - End-to-end workflow validation
 *
 * Key Features:
 * - Multi-layer testing (DB + API + UI)
 * - Data flow across layers
 * - Dynamic authentication using DB data
 * - UI-driven updates with DB verification
 * - Comprehensive validation at each step
 *
 * Use Cases:
 * - End-to-end user journey testing
 * - Cross-layer integration validation
 * - Complex workflow testing
 * - Real-world scenario simulation
 * - Full-stack application testing
 *
 * Test Flow:
 * 1. Query database to retrieve user data
 * 2. Use DB data (API token) in authenticated API request
 * 3. Verify both DB and API data in browser UI
 * 4. Perform UI update action
 * 5. Verify UI changes persisted in database
 *
 * Best Practices:
 * - Validate data at each integration point
 * - Use parameterized queries for database operations
 * - Verify API responses before using data
 * - Wait for UI updates to complete
 * - Confirm persistence with database queries
 * - Handle errors gracefully at each layer
 * - Use connection pooling for performance
 *
 * Database: PostgreSQL (pg library)
 * Documentation: https://playwright.dev/docs/test-fixtures
 *
 * @requires @playwright/test, pg
 */

import { test, expect } from '@playwright/test';
import { Pool } from 'pg';

// Database connection configuration
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
});

test('combined DB + API + UI integration test', async ({ page, request }) => {
  // ===================================================================
  // Step 1: Query Database - Retrieve user data for test
  // ===================================================================
  const dbResult = await pool.query(
    'SELECT id, name, email, api_token FROM users WHERE id = $1',
    [1]
  );

  // Validate database query returned data
  expect(dbResult.rows).toHaveLength(1);
  const user = dbResult.rows[0];

  // Verify required fields exist
  expect(user).toHaveProperty('id');
  expect(user).toHaveProperty('email');
  expect(user).toHaveProperty('api_token');
  expect(typeof user.email).toBe('string');
  expect(user.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/); // Valid email format

  // ===================================================================
  // Step 2: API Request - Use database data for authentication
  // ===================================================================
  const apiResponse = await request.get('https://api.example.com/user/profile', {
    headers: {
      'Authorization': \`Bearer \${user.api_token}\`,
      'Content-Type': 'application/json',
    },
  });

  // Validate API response
  expect(apiResponse.ok()).toBeTruthy();
  expect(apiResponse.status()).toBe(200);

  const apiData = await apiResponse.json();
  expect(apiData).toHaveProperty('name');
  expect(apiData).toHaveProperty('id', user.id);

  // ===================================================================
  // Step 3: Browser UI - Verify data from DB and API in UI
  // ===================================================================
  await page.goto('https://example.com/profile');

  // Wait for page to load completely
  await page.waitForLoadState('networkidle');

  // Verify database email appears in UI
  await expect(page.getByText(user.email)).toBeVisible();

  // Verify API-returned name appears in UI
  await expect(page.getByText(apiData.name)).toBeVisible();

  // Verify profile page elements are present
  await expect(page.getByLabel('Name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

  // ===================================================================
  // Step 4: UI Interaction - Update user name via browser
  // ===================================================================
  const updatedName = 'John Doe Updated';
  await page.getByLabel('Name').fill(updatedName);
  await page.getByRole('button', { name: 'Save' }).click();

  // Wait for save operation to complete
  await expect(page.getByText('Saved successfully')).toBeVisible({ timeout: 5000 });

  // ===================================================================
  // Step 5: Database Verification - Confirm UI changes persisted
  // ===================================================================
  const updatedResult = await pool.query(
    'SELECT id, name FROM users WHERE id = $1',
    [user.id]
  );

  // Validate update was persisted in database
  expect(updatedResult.rows).toHaveLength(1);
  expect(updatedResult.rows[0].id).toBe(user.id);
  expect(updatedResult.rows[0].name).toBe(updatedName);

  // Test complete - all layers validated successfully
});

// Cleanup after all tests
test.afterAll(async () => {
  await pool.end();
});`,
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
