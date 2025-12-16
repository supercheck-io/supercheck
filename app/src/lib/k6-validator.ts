/* ================================
   K6 SCRIPT VALIDATOR
   -------------------------------
   Validates k6 performance test scripts for common issues
=================================== */

export interface K6ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface K6ValidationOptions {
  selectedTestType?: string;
}

const k6ImportPattern = /import\s+.*\s+from\s+['"]k6(?:\/[^'"]*)?['"]/;

const PLAYWRIGHT_IMPORT_PATTERNS = [
  /import\s+.*\s+from\s+['"]@playwright\/test['"]/,
  /import\s+.*\s+from\s+['"]playwright\/?(?:test)?['"]/,
  /require\s*\(\s*['"]@playwright\/test['"]\s*\)/,
  /require\s*\(\s*['"]playwright\/?(?:test)?['"]\s*\)/,
];

/**
 * Detects whether a script imports any k6 modules.
 */
export const isK6Script = (script: string): boolean => k6ImportPattern.test(script);

/**
 * Validates a k6 script for common issues and best practices
 */
export function validateK6Script(
  script: string,
  options: K6ValidationOptions = {}
): K6ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Limit input length to prevent ReDoS attacks on regex patterns
  const MAX_SCRIPT_LENGTH = 500000; // 500KB limit
  if (script.length > MAX_SCRIPT_LENGTH) {
    return {
      valid: false,
      errors: ['Script exceeds maximum length (500KB)'],
      warnings: [],
    };
  }

  const normalizedType = options.selectedTestType?.toLowerCase();
  const scriptLooksLikeK6 = isK6Script(script);
  const isPerformanceType =
    normalizedType === "performance" || normalizedType === "k6";

  if (normalizedType && !isPerformanceType) {
    errors.push(
      `k6 scripts can only run when the test type is set to Performance. Current type: "${options.selectedTestType}".`
    );
  }

  if (!scriptLooksLikeK6) {
    errors.push(
      "This script does not import any k6 modules. Switch to a Playwright-based test type to run browser or API scripts."
    );
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  // Required: Must have k6 imports
  if (!k6ImportPattern.test(script)) {
    errors.push(
      'Script must import from k6 modules (e.g., import http from "k6/http")'
    );
  }

  // Required: Must have default export function
  if (!/export\s+default\s+(?:async\s+)?function/.test(script)) {
    errors.push('Script must export a default function');
  }

  // Warning: Recommend options export for test configuration
  if (!/export\s+const\s+options\s*=/.test(script)) {
    warnings.push(
      'Consider adding "export const options" to configure VUs, duration, and thresholds'
    );
  }

  // Error: Block Node.js modules (k6 doesn't support them)
  const forbiddenModules = [
    'fs',
    'path',
    'child_process',
    'net',
    'http',
    'https',
    'crypto',
    'os',
    'process',
    'buffer',
  ];

  forbiddenModules.forEach((mod) => {
    const nodeModulePattern = new RegExp(
      `require\\s*\\(\\s*['"]${mod}['"]\\s*\\)|import\\s+.*\\s+from\\s+['"]${mod}['"]`
    );
    if (nodeModulePattern.test(script)) {
      errors.push(
        `k6 does not support Node.js module "${mod}". Use k6 built-in modules instead.`
      );
    }
  });

  if (PLAYWRIGHT_IMPORT_PATTERNS.some((pattern) => pattern.test(script))) {
    errors.push(
      "Playwright modules are not supported in k6 performance scripts. Split Playwright tests into a Browser test."
    );
  }

  // Warning: Check for console.log usage (recommend using check() instead)
  if (/console\.log/.test(script)) {
    warnings.push(
      'Consider using k6 check() functions instead of console.log() for validation'
    );
  }

  // Warning: Check if thresholds are defined
  if (
    /export\s+const\s+options\s*=/.test(script) &&
    !/thresholds\s*:\s*\{/.test(script)
  ) {
    warnings.push(
      'Consider adding thresholds to define pass/fail criteria for your test'
    );
  }

  // Error: k6 does not support async/await in default function
  // Use Playwright for browser automation tests instead
  if (/export\s+default\s+async\s+function/.test(script)) {
    errors.push(
      'k6 does not support async/await. For browser testing, use Playwright test type instead.'
    );
  }

  // Error: Block experimental browser module which is unsupported in our runtime
  if (/import\s+[\s\S]*?from\s+['"]k6\/browser['"]/.test(script)) {
    errors.push(
      'The k6/browser module is not supported. Use Playwright tests for browser automation.'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get k6 script template with best practices
 */
export function getK6ScriptTemplate(): string {
  return `import http from 'k6/http';
import { check, sleep } from 'k6';

// Test configuration - all settings in script
export const options = {
  vus: 10,              // 10 virtual users
  duration: '30s',      // Run for 30 seconds

  // Pass/fail criteria
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests < 500ms
    http_req_failed: ['rate<0.1'],     // Error rate < 10%
  },
};

export default function() {
  // Test logic
  const response = http.get('https://test-api.k6.io/public/crocodiles/');

  // Validation checks
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}`;
}

/**
 * Location metadata for k6 execution
 * Uses kebab-case for internal representation
 */
export const K6_LOCATIONS = {
  US_EAST: {
    code: 'us-east' as const,
    name: 'US East',
    region: 'Ashburn',
    flag: '🇺🇸',
  },
  EU_CENTRAL: {
    code: 'eu-central' as const,
    name: 'EU Central',
    region: 'Nuremberg',
    flag: '🇩🇪',
  },
  ASIA_PACIFIC: {
    code: 'asia-pacific' as const,
    name: 'Asia Pacific',
    region: 'Singapore',
    flag: '🇸🇬',
  },
} as const;

export type K6LocationCode = keyof typeof K6_LOCATIONS;
