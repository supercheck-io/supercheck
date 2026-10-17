import { TestType } from "@/db/schema/types";

export interface CodeTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  testType: TestType;
  code: string;
  tags: string[];
  setup?: string;
}

export const codeTemplates: CodeTemplate[] = [
  // =========================
  // K6 Performance Templates
  // =========================
  {
    id: "k6-smoke-check",
    name: "Smoke Check (API)",
    description: "Short availability and latency sample before heavier runs",
    category: "Smoke & Health",
    testType: "performance",
    tags: ["k6", "smoke", "api"],
    code: `/**
 * k6 smoke test for availability and latency.
 * 
 * Purpose:
 * - Sample system availability during this run
 * - Check basic latency performance
 * - Check the configured latency and error budgets
 * 
 * Configuration:
 * - VUs: 5 virtual users running concurrently
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
  vus: 5,           // 5 concurrent users
  duration: '30s',  // Run for 30 seconds
  thresholds: {
    checks: ['rate>0.95'],
    http_req_failed: ['rate<0.01'],      // Error rate < 1%
    http_req_duration: ['p(95)<800'],    // 95% of requests < 800ms
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  const response = http.get(baseUrl + '/public/crocodiles/1/');

  // Validate response
  check(response, {
    'status is 200': (res) => res.status === 200,
    'body is not empty': (res) => res.body && res.body.length > 0,
  });

  sleep(1); // Pause between requests
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
 *   1. Ramp up to 5 VUs over 10 seconds
 *   2. Ramp from 5 to 10 VUs over 10 seconds
 *   3. Ramp down to 0 VUs over 10 seconds
 * - Thresholds: Strict latency and error limits
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 5 },   // Ramp-up to 5 VUs
    { duration: '10s', target: 10 },  // Ramp from 5 to 10 VUs
    { duration: '10s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],              // Error rate < 2%
    http_req_duration: ['p(95)<600', 'p(99)<1200'], // Latency thresholds
    checks: ['rate>0.95'],                       // 95% of checks pass
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  const response = http.get(baseUrl + '/public/crocodiles/');

  check(response, {
    'status is 200': (res) => res.status === 200,
    'request under 600ms': (res) => res.timings.duration < 600,
  });
  sleep(1);
}
`,
  },
  {
    id: "k6-spike-resilience",
    name: "Spike + Recovery",
    description: "Ramp arrival rate up and down to observe latency and errors",
    category: "Resilience",
    testType: "performance",
    tags: ["k6", "spike", "resilience"],
    code: `/**
 * Spike test to validate burst handling and recovery.
 * 
 * Purpose:
 * - Verify system stability during sudden traffic spikes
 * - Observe latency and errors after the spike subsides
 * - Correlate with your own autoscaling telemetry
 * 
 * Configuration:
 * - Executor: ramping-arrival-rate (controls throughput)
 * - Spike: Ramp 5 → 20 → 5 iterations/s over 30 seconds
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate', // Iterations per timeUnit
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { duration: '10s', target: 5 },     // Baseline: 5 iterations/s
        { duration: '10s', target: 20 },    // Ramp to 20 iterations/s
        { duration: '10s', target: 5 },     // Recovery: back to 5 iterations/s
      ],
    },
  },
  thresholds: {
    checks: ['rate>0.95'],
    http_req_failed: ['rate<0.05'],         // Allow 5% errors during spike
    http_req_duration: ['p(99)<1500'],      // 99% of requests < 1.5s
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  const res = http.get(baseUrl + '/public/crocodiles/2/');

  check(res, {
    '200 OK during spike': (r) => r.status === 200
  });

  // The arrival-rate executor controls pacing; no sleep is needed.
}
`,
  },
  {
    id: "k6-soak-reliability",
    setup: "This 40-second sample demonstrates the profile only. Extend it for endurance testing and monitor server resources.",
    name: "Soak / Endurance",
    description: "Short endurance profile to extend for sustained-load testing",
    category: "Reliability",
    testType: "performance",
    tags: ["k6", "soak", "endurance"],
    code: `/**
 * Soak test (Endurance test) to surface long-running issues.
 * 
 * Purpose:
 * - Extend the duration and correlate with server metrics to investigate memory leaks
 * - Correlate with server metrics to investigate resource exhaustion
 * - Monitor performance degradation over time
 * 
 * Configuration:
 * - VUs: 5 virtual users with steady load
 * - Duration: 40 seconds (warm-up → hold → cool-down)
 * - Thresholds:
 *   - Error rate must be < 1%
 *   - 95th percentile response time < 700ms
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 5 },    // Warm-up to 5 VUs
    { duration: '20s', target: 5 },    // Hold steady load
    { duration: '10s', target: 0 },    // Cool-down
  ],
  thresholds: {
    checks: ['rate>0.95'],
    http_req_failed: ['rate<0.01'],    // Must maintain <1% error rate
    http_req_duration: ['p(95)<700'],  // Aggregate latency budget
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  const response = http.get(baseUrl + '/public/crocodiles/3/');

  check(response, {
    'status is 200': (res) => res.status === 200
  });

  sleep(2); // Realistic pacing
}
`,
  },
  {
    id: "k6-api-checklist",
    setup: "GET and simulated POST run without setup. Add an API_TOKEN secret for test-api.k6.io to include the authenticated GET.",
    name: "API Checklist (GET + POST + auth)",
    description: "Public GET, simulated POST, and optional authenticated GET",
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
 * - VUs: 5 concurrent users
 * - Duration: 30 seconds
 * - Project secret: Optional API_TOKEN enables the authenticated request
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.02'],      // Error rate < 2%
    http_req_duration: ['p(95)<450'],    // 95% of requests < 450ms
    checks: ['rate>0.98'],               // 98% of checks pass
  },
};

export default function () {
  const baseUrl = 'https://test-api.k6.io';
  const token = getSecret('API_TOKEN', { required: false }) || ''; // Optional project secret

  // GROUP 1: List resources
  group('list resources', () => {
    const res = http.get(baseUrl + '/public/crocodiles/');
    check(res, { 'listed resources': (r) => r.status === 200 });
  });

  // GROUP 2: Create resource
  group('create resource', () => {
    const payload = JSON.stringify({
      title: 'Load Test',
      body: 'Simulated write; JSONPlaceholder does not persist this post',
      userId: 1,
    });
    const res = http.post('https://jsonplaceholder.typicode.com/posts', payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    check(res, { 'created resource': (r) => r.status === 201 });
  });

  // GROUP 3: Authenticated request
  group('authenticated request', () => {
    if (!token) return; // Auth checks run only when API_TOKEN is configured

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

// Custom metrics: Rate (percentages) and Trend (numeric distributions)
const errorRate = new Rate('custom_error_rate');
const customDuration = new Trend('custom_duration');

export const options = {
  vus: 5,
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
  const baseUrl = 'https://jsonplaceholder.typicode.com';
  const res = http.get(baseUrl + '/posts/1');

  // Comprehensive response validation
  const checkResult = check(res, {
    'status is 200': (r) => r.status === 200,
    'content-type is JSON': (r) => r.headers['Content-Type']?.includes('application/json'),
    'body is valid JSON': (r) => {
      try { JSON.parse(r.body); return true; } catch { return false; }
    },
    'has expected fields': (r) => {
      try {
        const data = JSON.parse(r.body);
        return data !== null && data.id !== undefined && data.title !== undefined;
      } catch { return false; }
    },
    'response time < 500ms': (r) => r.timings.duration < 500,
    'response size < 10KB': (r) => r.body !== null && r.body.length < 10240,
  });

  // Track custom metrics
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
 * - VUs: 5→10 virtual users (ramp-up → hold → ramp-down)
 * - Duration: 30 seconds total
 * - Thresholds: 
 *   - Global latency limits
 *   - Specific limits for 'read' and 'write' operations
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics: Counter, Rate, Trend
const apiCalls = new Counter('api_calls');
const successRate = new Rate('success_rate');
const apiLatency = new Trend('api_latency');

export const options = {
  stages: [
    { duration: '10s', target: 5 },   // Ramp-up to 5 VUs
    { duration: '10s', target: 10 },  // Ramp from 5 to 10 VUs
    { duration: '10s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration': ['avg<300', 'p(50)<200', 'p(90)<500', 'p(95)<700', 'p(99)<1000'],
    'checks': ['rate>0.95'],
    'success_rate': ['rate>0.98'],
    'api_latency': ['p(95)<300', 'p(99)<500'],
    'http_req_duration{endpoint:read}': ['p(95)<400'],  // Tag-based thresholds
    'http_req_duration{endpoint:write}': ['p(95)<500'],
  },
};

export default function () {
  const baseUrl = 'https://jsonplaceholder.typicode.com';

  // READ operation (tagged)
  const getRes = http.get(baseUrl + '/posts/1', { tags: { endpoint: 'read' } });
  apiCalls.add(1);
  const getSuccess = check(getRes, {
    'GET successful': (r) => r.status === 200,
    'has content': (r) => r.body && r.body.length > 0,
  });
  successRate.add(getSuccess);
  apiLatency.add(getRes.timings.duration);

  // WRITE operation (tagged)
  const postRes = http.post(
    baseUrl + '/posts',
    JSON.stringify({ title: 'Test', body: 'Load test', userId: 1 }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'write' },
    }
  );
  apiCalls.add(1);
  const postSuccess = check(postRes, { 'POST successful': (r) => r.status === 201 });
  successRate.add(postSuccess);
  apiLatency.add(postRes.timings.duration);

  sleep(1);
}
`,
  },
  {
    id: "k6-stress-test",
    setup: "Small 5–10 VU example. Increase the stages for your own target and monitor server metrics to investigate capacity and recovery.",
    name: "Stress Test",
    description: "Staged load profile to adapt for stress and recovery testing",
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
 * - VUs: 5→10 virtual users (step-wise increase)
 * - Duration: 50 seconds total
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
    // Level 1: Light load
    { duration: '10s', target: 5 },
    { duration: '10s', target: 5 },
    // Level 2: Moderate load
    { duration: '10s', target: 10 },
    { duration: '10s', target: 10 },
    // Recovery
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    'http_req_failed': ['rate<0.1'],      // Allow 10% errors under stress
    'http_req_duration': ['p(95)<5000'],  // Allow 5s latency
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
    description: "Bounded arrival-rate ramp with failure thresholds that abort the run",
    category: "Resilience",
    testType: "performance",
    tags: ["k6", "breakpoint", "capacity"],
    code: `/**
 * Bounded breakpoint profile; increase load for your own target.
 * 
 * Purpose:
 * - Explore failure thresholds within the configured load range
 * - Determine the "knee" of the curve where latency spikes
 * 
 * Configuration:
 * - Arrival rate: 5 → 30 iterations/s, with 10-20 available VUs
 * - Duration: 30 seconds total
 * - Thresholds: Abort when a threshold evaluation detects excessive errors or latency
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 20,
      stages: [
        { target: 10, duration: '10s' },
        { target: 20, duration: '10s' },
        { target: 30, duration: '10s' },
      ],
    },
  },
  thresholds: {
    checks: ['rate>0.95'],
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
  {
    id: "k6-websocket",
    name: "WebSocket + API Load Test",
    description: "Combined WebSocket and REST API load testing",
    category: "Protocols",
    testType: "performance",
    tags: ["k6", "websocket", "api", "realtime"],
    code: `/**
 * Combined WebSocket + REST API Load Test.
 * 
 * Purpose:
 * - Test WebSocket connections alongside HTTP API calls
 * - Generates HTTP metrics for report chart visibility
 * 
 * Configuration:
 * - VUs: 5, Duration: 30s
 * - Thresholds: p95 latency < 500ms, error rate < 5%
 * 
 * @requires k6 binary with WebSocket support
 */

import { check, sleep, group } from 'k6';
import http from 'k6/http';
import ws from 'k6/ws';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
    checks: ['rate>0.95'],
  },
};

export default function () {
  // REST API calls for report metrics
  group('REST API', () => {
    check(http.get('https://test-api.k6.io/public/crocodiles/'), { 'list ok': (r) => r.status === 200 });
    check(http.get('https://test-api.k6.io/public/crocodiles/1/'), { 'item ok': (r) => r.status === 200 });
    check(http.get('https://test-api.k6.io/public/crocodiles/2/'), { 'item2 ok': (r) => r.status === 200 });
  });

  // WebSocket echo test
  group('WebSocket', () => {
    let echoed = false;
    const response = ws.connect('wss://echo.websocket.org', {}, (socket) => {
      socket.on('open', () => socket.send('Hello from k6!'));
      socket.on('message', (message) => {
        if (message !== 'Hello from k6!') return;
        echoed = true;
        socket.close();
      });
      socket.setTimeout(() => socket.close(), 3000);
    });
    check(response, {
      'WebSocket upgraded': (r) => r && r.status === 101,
      'echo received': () => echoed,
    });
  });

  sleep(0.5);
}
`,
  },
  {
    id: "k6-grpc",
    name: "gRPC + API Load Test",
    description: "Combined gRPC and REST API load testing",
    category: "Protocols",
    testType: "performance",
    tags: ["k6", "grpc", "api", "protobuf"],
    code: `/**
 * Combined gRPC + REST API Load Test.
 * 
 * Purpose:
 * - Test gRPC service calls alongside HTTP API calls
 * - Uses gRPC reflection (no .proto file needed)
 * - Generates HTTP metrics for report chart visibility
 * 
 * Configuration:
 * - VUs: 5, Duration: 30s
 * - Thresholds: p95 latency < 500ms, 90%+ checks pass
 * 
 * @requires k6 binary with gRPC support
 */

import http from 'k6/http';
import grpc from 'k6/net/grpc';
import { check, sleep, group } from 'k6';

const client = new grpc.Client();

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
    checks: ['rate>0.9'],
  },
};

export default function () {
  // REST API calls for report metrics
  group('REST API', () => {
    check(http.get('https://test-api.k6.io/public/crocodiles/'), { 'list ok': (r) => r.status === 200 });
    check(http.get('https://test-api.k6.io/public/crocodiles/1/'), { 'item ok': (r) => r.status === 200 });
    check(http.get('https://test-api.k6.io/public/crocodiles/2/'), { 'item2 ok': (r) => r.status === 200 });
  });

  // gRPC unary call using reflection
  group('gRPC', () => {
    let response = null;
    try {
      client.connect('grpcbin.test.k6.io:9001', { reflect: true });
      response = client.invoke('grpcbin.GRPCBin/DummyUnary', { f_string: 'test', f_int32: 42 });
    } catch (error) {
      console.error('gRPC request failed:', error);
    } finally {
      client.close();
    }
    check(response, { 'gRPC ok': (r) => r !== null && r.status === grpc.StatusOK });
  });

  sleep(0.5);
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
 * Mobile viewport testing with @mobile tag.
 * 
 * Purpose:
 * - Verify layout on mobile screen sizes
 * - Test responsive design behavior
 * 
 * Note: Uses @mobile tag to run on Mobile Safari (iPhone 13)
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

// Use @mobile tag to run on iPhone 13 (390x844 viewport)
test.describe('Mobile layout test', { tag: ['@mobile'] }, () => {
  test('mobile viewport exposes key actions', async ({ page }) => {
    await page.goto(APP_URL);

    // Verify we're running in mobile viewport
    const viewport = page.viewportSize();
    console.log('Viewport:', viewport?.width, 'x', viewport?.height);

    // Mobile viewport should be smaller than desktop
    expect(viewport?.width).toBeLessThan(500);

    await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();

    // Test mobile interactions
    await page.getByPlaceholder('What needs to be done?').fill('Mobile task');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listitem').first()).toContainText('Mobile task');
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
  
  locale: 'en-US',
  timezoneId: 'Europe/Rome',
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
 * - Run tests only on specific browsers
 * - Demonstrate how to use the 'tag' option in test.describe
 * 
 * Supported Tags:
 * - @chromium: Runs on Desktop Chrome (default)
 * - @firefox: Runs on Desktop Firefox
 * - @webkit or @safari: Runs on Desktop Safari (WebKit)
 * - @mobile or @iphone: Runs on Mobile Safari (iPhone 13)
 * 
 * Note: Tests without tags run on Chromium by default.
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
    name: "Simulated API CRUD",
    description: "Create, read, and update against a non-persistent demo API",
    category: "API CRUD",
    testType: "api",
    tags: ["playwright", "api", "crud"],
    code: `/**
 * API CRUD flow demonstration.
 * 
 * Purpose:
 * - Demonstrate Create, Read operations
 * - Show serial test execution pattern
 * 
 * Note: JSONPlaceholder is a fake API - POST returns
 * simulated data but doesn't persist it.
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

const API_URL = 'https://jsonplaceholder.typicode.com';

test.describe.serial('posts CRUD', () => {
  test('creates a post (simulated)', async ({ request }) => {
    const response = await request.post(API_URL + '/posts', {
      data: { title: 'Playwright', body: 'API example', userId: 1 },
    });

    // JSONPlaceholder returns 201 for simulated creation
    expect(response.status()).toBe(201);
    const json = await response.json();
    expect(json).toMatchObject({ title: 'Playwright', body: 'API example' });
  });

  test('reads an existing post', async ({ request }) => {
    // Fetch an existing post (IDs 1-100 exist)
    const response = await request.get(API_URL + '/posts/1');
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.id).toBe(1);
    expect(json).toHaveProperty('title');
  });

  test('updates a post (simulated)', async ({ request }) => {
    const response = await request.put(API_URL + '/posts/1', {
      data: { id: 1, title: 'Updated', body: 'Updated body', userId: 1 },
    });
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.title).toBe('Updated');
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
 * Authenticated API call demonstration.
 * 
 * Purpose:
 * - Demonstrate how to inject authorization headers
 * - Show both Basic Auth and Bearer token patterns
 * - Learn patterns for testing protected endpoints
 * 
 * Configuration:
 * - Uses httpbin.org which validates credentials
 * - Works out of the box - no real credentials needed
 * 
 * In production, replace httpbin.org with your API URL
 * and use environment variables for credentials.
 * 
 * @requires @playwright/test
 */

import { expect, test } from '@playwright/test';

test.describe('authenticated API request', () => {
  test('basic authentication flow', async ({ request }) => {
    // httpbin /basic-auth/{user}/{password} validates Basic Auth
    const response = await request.get('https://httpbin.org/basic-auth/test/test', {
      headers: {
        'Authorization': 'Basic ' + btoa('test:test')
      }
    });

    // httpbin returns 200 if credentials are valid
    expect(response.status()).toBe(200);
    
    const body = await response.json();
    expect(body.authenticated).toBe(true);
    expect(body.user).toBe('test');
  });

  test('bearer token authentication', async ({ request }) => {
    // httpbin /bearer validates Bearer token presence
    const response = await request.get('https://httpbin.org/bearer', {
      headers: {
        'Authorization': 'Bearer demo-token-12345'
      }
    });

    expect(response.status()).toBe(200);
    
    const body = await response.json();
    expect(body.authenticated).toBe(true);
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
import { Client } from 'pg';

const client = new Client({
  connectionString: 'postgres://reader:NWDMCE5xdipIjRrp@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs',
  ssl: false,
});

// Cheap heartbeat query to ensure the database is reachable.
test.describe('database read health check', () => {
  test('rnc_database table returns expected columns', async () => {
    try {
      await client.connect();
    
      // Execute a simple SELECT query on the RNAcentral database
      const result = await client.query('SELECT id, descr, current_release FROM rnc_database LIMIT 5');
    
      // Verify we got results and the schema matches expectations
      expect(result.rowCount).toBeGreaterThan(0);
      expect(result.rows[0]).toHaveProperty('id');
      expect(result.rows[0]).toHaveProperty('descr');
    
    } finally {
      await client.end();
    }
  });
});
`,
  },
  {
    id: "pw-db-transaction",
    name: "Read-only transaction",
    description: "Compares reads in a repeatable-read transaction, then rolls back",
    category: "Transactions",
    testType: "database",
    tags: ["playwright", "database", "transaction"],
    code: `/**
 * Transaction isolation demonstration.
 * 
 * Purpose:
 * - Demonstrate PostgreSQL transaction concepts
 * - Show how BEGIN/COMMIT/ROLLBACK work
 * - Verify transaction isolation with consistent reads
 * 
 * Key Concepts:
 * - BEGIN: Starts a transaction block
 * - COMMIT: Makes changes permanent
 * - ROLLBACK: Discards all changes in the transaction
 * 
 * Note: Uses RNAcentral public database (read-only)
 * In production, use this pattern for write operations.
 * 
 * @requires @playwright/test, pg
 */

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

const client = new Client({
  connectionString: 'postgres://reader:NWDMCE5xdipIjRrp@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs',
  ssl: false,
});

// Demonstrate transaction isolation with reads
test.describe('database transaction demonstration', () => {
  test('transaction isolation ensures consistent reads', async () => {
    try {
      await client.connect();

      // Start a transaction
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

      // First read within transaction
      const firstRead = await client.query('SELECT COUNT(*) as total FROM rnc_database');
      const countAtStart = parseInt(firstRead.rows[0].total);

      // Second read within same transaction (should see same count)
      const secondRead = await client.query('SELECT COUNT(*) as total FROM rnc_database');
      const countAtEnd = parseInt(secondRead.rows[0].total);

      // Within a transaction, both reads should return the same value
      expect(countAtStart).toBe(countAtEnd);

      // End the transaction
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });
});
`,
  },
  {
    id: "pw-db-update",
    name: "Query plan analysis",
    description: "Runs EXPLAIN and SELECT; includes a commented UPDATE pattern",
    category: "Database checks",
    testType: "database",
    tags: ["playwright", "database", "update"],
    code: `/**
 * SQL Query Analysis with EXPLAIN.
 * 
 * Purpose:
 * - Demonstrate query execution plan analysis
 * - Understand query performance before running
 * - Learn UPDATE/DELETE safety patterns
 * 
 * Key Concepts:
 * - EXPLAIN: Shows query execution plan without running
 * - WHERE clauses: Essential for safe UPDATE/DELETE
 * - RETURNING clause: Get affected rows after modification
 * 
 * Note: Uses RNAcentral public database (read-only)
 * UPDATE patterns are shown in comments for reference.
 * 
 * @requires @playwright/test, pg
 */

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

const client = new Client({
  connectionString: 'postgres://reader:NWDMCE5xdipIjRrp@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs',
  ssl: false,
});

test.describe('SQL query analysis', () => {
  test('analyze query execution plan', async () => {
    try {
      await client.connect();

      // Use EXPLAIN to analyze a SELECT query
      const explainResult = await client.query(
        'EXPLAIN SELECT id, descr FROM rnc_database WHERE current_release IS NOT NULL LIMIT 10'
      );

      // EXPLAIN returns the query plan as rows
      expect(explainResult.rows.length).toBeGreaterThan(0);
    
      // Run the actual query
      const result = await client.query(
        'SELECT id, descr, current_release FROM rnc_database WHERE current_release IS NOT NULL LIMIT 5'
      );

      expect(result.rowCount).toBeGreaterThan(0);
      expect(result.rows[0]).toHaveProperty('id');

      // Production UPDATE pattern example (commented):
      // const updateResult = await client.query(
      //   'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name',
      //   ['New Name', 123]
      // );
      // expect(updateResult.rowCount).toBe(1);

    } finally {
      await client.end();
    }
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
 * - Page Object: Encapsulates page-specific logic (goto, addTodo, getTodo)
 * 
 * @requires @playwright/test
 */

import { test as base, expect, type Locator } from '@playwright/test';

const APP_URL = 'https://demo.playwright.dev/todomvc';

type TodoPage = {
  goto: () => Promise<void>;
  addTodo: (text: string) => Promise<void>;
  getTodo: (index: number) => Locator;
};

// Extend base test with a typed custom fixture.
const test = base.extend<{ todoPage: TodoPage }>({
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
      
      getTodo: (index) => page.getByRole('listitem').nth(index),
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
    await expect(todoPage.getTodo(0)).toContainText('Buy groceries');
  });

  test('add multiple todos', async ({ todoPage }) => {
    await todoPage.addTodo('Task 1');
    await todoPage.addTodo('Task 2');
    
    await expect(todoPage.getTodo(0)).toContainText('Task 1');
    await expect(todoPage.getTodo(1)).toContainText('Task 2');
  });
});
`,
  },

  {
    id: "pw-custom-form-stubbing",
    setup: "Uses a synthetic form and intercepted API response. Replace the form and route with your application.",
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

test('submits a form through a stubbed API', async ({ page }) => {
  await page.route('https://example.com/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<form><label>Title<input name="title"></label><button>Save</button></form><p role="status"></p>' +
      '<script>document.querySelector("form").onsubmit = async (event) => {' +
      'event.preventDefault(); const title = document.querySelector("input").value;' +
      'const response = await fetch("/todos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });' +
      'const todo = await response.json(); document.querySelector("[role=status]").textContent = todo.title;' +
      '};</script>',
  }));
  // Later routes take precedence over the synthetic page route.
  await page.route('https://example.com/todos', route => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ id: 999, title: route.request().postDataJSON().title }),
  }));
  await page.goto('https://example.com/');
  const created = page.waitForResponse('https://example.com/todos');
  await page.getByLabel('Title').fill('API stubbed todo');
  await page.getByRole('button', { name: 'Save' }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole('status')).toHaveText('API stubbed todo');
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
    name: "API response + UI input",
    description: "Uses a simulated API response as input for an independent demo UI",
    category: "Cross-layer",
    testType: "custom",
    tags: ["playwright", "api", "ui"],
    code: `/**
 * Cross-layer demo: pass a simulated API response into a separate UI.
 * 
 * Purpose:
 * - Demonstrate end-to-end testing across layers
 * - Use the simulated API response as test input
 * - Use UI for user-centric verification
 * - Demonstrate a simulated API DELETE
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

test.describe('API response + UI input', () => {
  test('uses API response data in the UI', async ({ page, request }) => {
    // These demo services do not share a backend. POST and DELETE are simulated.
    // 1. Create test input using the demo API
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
 * Comprehensive browser automation test suite.
 * 
 * Purpose:
 * - Test page title and navigation
 * - Verify element visibility and form interactions
 * - Demonstrate core Playwright patterns
 * 
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test.describe('browser automation tests', () => {
  test('page title verification', async ({ page }) => {
    // Navigate to Playwright docs and verify page metadata
    await page.goto('https://playwright.dev/');

    // Verify document title matches expected pattern
    await expect(page).toHaveTitle(/Playwright/);
    console.log('✅ Page title verified successfully');
  });

  test('navigation and element visibility', async ({ page }) => {
    // Test multi-step navigation flow through the application
    await page.goto('https://playwright.dev/');

    // Click navigation link to move to next page
    await page.getByRole('link', { name: 'Get started' }).click();

    // Verify the target page loaded with expected content
    await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
    console.log('✅ Navigation and element visibility verified');
  });

  test('form interaction', async ({ page }) => {
    // Test form input, submission, and data handling
    await page.goto('https://demo.playwright.dev/todomvc');

    // Fill form field with test data
    await page.getByPlaceholder('What needs to be done?').fill('Test automation with Playwright');

    // Submit form by pressing Enter
    await page.getByPlaceholder('What needs to be done?').press('Enter');

    // Verify form data was persisted and appears in the UI
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
 * Comprehensive REST API test suite.
 * 
 * Purpose:
 * - Test GET, POST requests and response validation
 * - Verify error handling (404, missing resources)
 * - Demonstrate API testing patterns
 * 
 * @requires @playwright/test
 */

import { test, expect } from '@playwright/test';

test.describe('API endpoint tests', () => {
  test('GET request with status and data validation', async ({ request }) => {
    // Test GET request and validate response structure
    const response = await request.get('https://jsonplaceholder.typicode.com/todos/1');

    // Verify successful response status
    expect(response.status()).toBe(200);

    // Validate complete response payload structure
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
    // Test POST request with data payload and verify creation
    const newTodo = {
      title: 'Test API with Playwright',
      completed: false,
      userId: 1
    };

    // Submit POST request with payload
    const response = await request.post('https://jsonplaceholder.typicode.com/todos', {
      data: newTodo
    });

    // Verify creation response status
    expect(response.status()).toBe(201);

    // Validate response contains expected fields
    const responseData = await response.json();
    expect(responseData).toHaveProperty('id');
    expect(responseData.title).toBe(newTodo.title);
    console.log('✅ POST request validated successfully');
  });

  test('error handling for non-existent resource', async ({ request }) => {
    // Test 404 error handling for missing resources
    const response = await request.get('https://jsonplaceholder.typicode.com/todos/999999');

    // Verify 404 not found response
    expect(response.status()).toBe(404);

    // Validate empty response body for missing resource
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
    setup: "Calls the public GitHub API without authentication; rate limits and upstream page changes can affect this example.",
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
      averageComments: issues.length === 0 ? 0 : Math.round(issues.reduce((sum, issue) => sum + issue.comments, 0) / issues.length)
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
    await expect(page).toHaveURL(new RegExp(username));
    console.log(\`✅ Confirmed on \${username}'s profile page\`);

    console.log("✅ User profile analysis completed successfully");
  });
});
`,
  },
  {
    id: "k6-data-driven-file",
    setup: "Requires a USERS_CSV file variable with username,password columns and valid demo API accounts. Each data row starts one VU; use a small file to limit load. Simple CSV only: no quoted commas or multiline values.",
    name: "Data-Driven Performance Test (File Variable)",
    description: "Read test data from a CSV file variable for parameterized k6 load testing",
    category: "Data-Driven",
    testType: "performance",
    tags: ["k6", "file", "csv", "data-driven"],
    code: `/**
 * Data-driven k6 performance test using file variables.
 *
 * Prerequisites:
 * 1. Open Variables in the current project
 * 2. Create a File-type variable named "USERS_CSV" and upload a CSV file
 *    Example CSV content:
 *      username,password
 *      user1@example.com,pass123
 *      user2@example.com,pass456
 *      user3@example.com,pass789
 *
 * Use getFile(key) with k6's open() in init context.
 * For shared datasets, parse the file inside SharedArray so VUs reuse memory.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// Parse CSV into a SharedArray for efficient memory usage across VUs
const users = new SharedArray('users', function () {
  const usersCsvContent = open(getFile('USERS_CSV'));

  const lines = usersCsvContent.trim().split('\\n');
  if (lines[0].trim() !== 'username,password') throw new Error('USERS_CSV header must be username,password');
  return lines.slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const columns = line.split(',');
      if (columns.length !== 2 || line.includes('"')) throw new Error('USERS_CSV requires username,password as two unquoted columns');
      const [username, password] = columns;
      if (!username?.trim() || !password?.trim()) throw new Error('USERS_CSV requires username,password on each row');
      return { username: username.trim(), password: password.trim() };
    });
});

if (users.length === 0) throw new Error('USERS_CSV needs at least one data row');

export const options = {
  vus: users.length,          // One VU per user row
  duration: '30s',
  thresholds: {
    checks: ['rate>0.95'],
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function () {
  // Each VU picks its own row based on VU ID
  const user = users[__VU - 1];

  const payload = JSON.stringify({
    username: user.username,
    password: user.password,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const response = http.post(
    'https://test-api.k6.io/auth/token/login/',
    payload,
    params,
  );

  check(response, {
    'login status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}`,
  },
  {
    id: "k6-basic",
    name: "Basic Performance Test",
    description: "Simple load test with virtual users and thresholds",
    category: "Smoke & Health",
    testType: "performance",
    tags: ["k6", "basic", "performance"],
    code: `/**
 * Basic k6 performance test script.
 * 
 * Purpose:
 * - Verify baseline API performance under load
 * - Check response times meet thresholds (p95 < 500ms)
 * - Monitor error rates during operation
 * 
 * Configuration:
 * - VUs: 5 concurrent users
 * - Duration: 30 seconds
 * 
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,                     // 5 virtual users
  duration: '30s',            // Run for 30 seconds
  thresholds: {
    checks: ['rate>0.95'],
    http_req_duration: ['p(95)<500'],  // 95% of requests < 500ms
    http_req_failed: ['rate<0.1'],     // Error rate < 10%
  },
};

export default function() {
  const response = http.get('https://test-api.k6.io/public/crocodiles/');

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1); // Pause between requests to simulate user think time
}`,
  },
  {
    id: "pw-data-driven-file",
    setup: "Requires a TEST_DATA file variable with url,expectedTitle columns. Simple CSV only: no quoted commas or multiline values.",
    name: "Data-Driven Test (File Variable)",
    description: "Read a simple CSV file variable for parameterized browser tests",
    category: "Data-Driven",
    testType: "browser",
    tags: ["playwright", "file", "csv", "data-driven"],
    code: `/**
 * Data-driven Playwright test using file variables.
 *
 * Prerequisites:
 * 1. Open Variables in the current project
 * 2. Create a File-type variable named "TEST_DATA" and upload a CSV file with columns: url,expectedTitle
 *    Example CSV content:
 *      url,expectedTitle
 *      https://playwright.dev,Playwright
 *      https://example.com,Example Domain
 *
 * Use readFile(key) to read the file contents directly in Playwright.
 * k6 tests should use open(getFile(key)) in init context instead.
 */

import { test, expect } from '@playwright/test';

// readFile() returns the file contents as a string directly
const playwrightCsvContent = readFile('TEST_DATA');
const lines = playwrightCsvContent.trim().split('\\n');
if (lines[0].trim() !== 'url,expectedTitle') throw new Error('TEST_DATA header must be url,expectedTitle');
const rows = lines.slice(1)
  .filter((line) => line.trim().length > 0)
  .map((line) => {
    const columns = line.split(',');
    if (columns.length !== 2 || line.includes('"')) throw new Error('TEST_DATA requires url,expectedTitle as two unquoted columns');
    const [url, expectedTitle] = columns;
    if (!url?.trim() || !expectedTitle?.trim()) throw new Error('TEST_DATA requires url,expectedTitle on each row');
    return { url: url.trim(), expectedTitle: expectedTitle.trim() };
  });

if (rows.length === 0) throw new Error('TEST_DATA needs at least one data row');

for (const [index, { url, expectedTitle }] of rows.entries()) {
  test(\`row \${index + 1}: page title contains "\${expectedTitle}" for \${url}\`, async ({ page }) => {
    await page.goto(url);
    await expect(page).toHaveTitle(new RegExp(expectedTitle.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&')));
  });
}
`,
  },
  {
    id: "pw-failure-diagnostics",
    setup: "Uses a synthetic page. Adapt the URL filter to your app; HAR files may include sensitive headers and response bodies.",
    name: "Failure Diagnostics",
    description: "Rich failure traces, annotated retry videos, and a scoped network HAR",
    category: "Diagnostics",
    testType: "browser",
    tags: ["trace", "video", "har", "retries"],
    code: `import { test, expect } from '@playwright/test';

// These captures apply only to this test file, including its retries.
// HAR files stay in the isolated test output; attach them to reports only on failure.
test.use({
  trace: { mode: 'retain-on-failure-and-retries', snapshots: { dom: true, aria: true, screen: true } },
  video: { mode: 'retain-on-failure-and-retries', show: { actions: { position: 'top-right' } } },
});

const recordingContexts = new WeakSet();

test.beforeEach(async ({ context }, testInfo) => {
  await context.tracing.startHar(testInfo.outputPath('network.har'), {
    content: 'embed',
    urlFilter: 'https://example.com/**',
  });
  recordingContexts.add(context);
});

test.afterEach(async ({ context }, testInfo) => {
  if (!recordingContexts.delete(context)) return;
  await context.tracing.stopHar();
  const harPath = testInfo.outputPath('network.har');
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('network.har', { path: harPath, contentType: 'application/json' });
  }
});

test('diagnose a page', async ({ page }) => {
  // Replace this synthetic page and HAR URL filter with your application.
  await page.route('https://example.com/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<h1>Example application</h1><button>Continue</button>',
  }));
  await test.step('Open the application', async () => {
    await page.goto('https://example.com/');
    await expect(page.getByRole('heading')).toHaveText('Example application');
    await page.getByRole('button', { name: 'Continue' }).click();
  }, { subtitle: 'synthetic account', params: { origin: 'https://example.com' } });
});
`,
  },
  {
    id: "pw-passkey-authentication",
    setup: "Uses a virtual authenticator and synthetic challenges. Adapt to your real registration and sign-in flow to test server verification.",
    name: "Passkey Registration and Sign-In",
    description: "Exercise WebAuthn with a virtual authenticator, without hardware keys",
    category: "Authentication",
    testType: "browser",
    tags: ["passkey", "webauthn", "authentication"],
    code: `import { test, expect } from '@playwright/test';

test('register and authenticate a passkey', async ({ context, page }) => {
  await context.credentials.install();
  await page.route('https://example.com/**', route => route.fulfill({
    contentType: 'text/html', body: '<h1>Passkey example</h1>',
  }));
  await page.goto('https://example.com/');

  // For a real application, use its registration/sign-in UI, server challenges, and relying-party ID.
  const passkey = await test.step('Register a passkey', async () => page.evaluate(async () => {
    const credential = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Example application', id: 'example.com' },
      user: { id: new Uint8Array([1, 2, 3, 4]), name: 'test-user', displayName: 'Test User' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 15000,
    } });
    if (!(credential instanceof PublicKeyCredential)) {
      throw new Error('Expected a passkey');
    }
    return { id: credential.id, rawId: Array.from(new Uint8Array(credential.rawId)) };
  }), { subtitle: 'virtual authenticator' });

  const signedInId = await test.step('Sign in with the passkey', async () => page.evaluate(async (passkey) => {
    const credential = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: 'example.com',
      allowCredentials: [{ type: 'public-key', id: new Uint8Array(passkey.rawId) }],
      userVerification: 'required',
      timeout: 15000,
    } });
    return credential?.id;
  }, passkey), { subtitle: 'same relying party' });
  expect(signedInId).toBe(passkey.id);
});
`,
  },
  {
    id: "pw-webmcp-tools",
    setup: "Experimental Chromium feature. Uses a synthetic page-defined tool; browser support may vary.",
    name: "WebMCP Tools (Experimental, Chromium)",
    description: "Discover and call a page-defined tool using Chromium's experimental WebMCP support",
    category: "AI Applications",
    testType: "browser",
    tags: ["webmcp", "experimental", "chromium"],
    code: `import { test, expect } from '@playwright/test';

// Opt in for this file only; use Chromium, not @firefox or @webkit tags.
test.use({ launchOptions: { args: ['--enable-features=WebMCP'] } });

test('discover and call a WebMCP tool', async ({ page }) => {
  // Replace the synthetic registration with your WebMCP-enabled application.
  await page.route('https://example.com/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<h1>WebMCP example</h1><script>' +
      'const modelContext = navigator.modelContext || document.modelContext;' +
      'if (!modelContext) throw new Error("WebMCP is unavailable in this browser");' +
      'modelContext.registerTool({' +
      'name: "add", description: "Add two numbers",' +
      'inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },' +
      'execute: ({a, b}) => ({ content: [{ type: "text", text: String(a + b) }] })' +
      '});</script>',
  }));
  await page.goto('https://example.com/');
  await test.step('Discover tools', async () => {
    const tools = await page.webmcp.tools();
    expect(tools.map(tool => tool.name)).toContain('add');
  });
  await test.step('Call the tool', async () => {
    const result = await page.webmcp.callTool('add', { a: 2, b: 3 });
    expect(result.content).toEqual([{ type: 'text', text: '5' }]);
  }, { params: { a: 2, b: 3 } });
});
`,
  },
  {
    id: "pw-resource-lock",
    name: "Shared Resource Lock",
    description: "Serialize tests sharing a resource within one Playwright job",
    category: "Reliability",
    testType: "browser",
    tags: ["lock", "parallel", "isolation"],
    code: `import { test, expect } from '@playwright/test';

// Use the same name in every file that mutates this resource within a job.
// Locks do not coordinate separate Supercheck runs or jobs.
test.describe.configure({ lock: 'shared-account-settings' });

test('update profile', async ({ page }) => {
  // Replace this synthetic form with your application's shared account.
  await page.setContent('<h1>Profile</h1><input aria-label="Display name" value="Test User">');
  await test.step('Change the display name', async () => {
    await page.getByLabel('Display name').fill('Updated User');
    await expect(page.getByLabel('Display name')).toHaveValue('Updated User');
  }, { subtitle: 'serialized within this job' });
});

test('read profile', async ({ page }) => {
  await page.setContent('<h1>Profile</h1><input aria-label="Display name" value="Test User">');
  await expect(page.getByLabel('Display name')).toHaveValue('Test User');
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
