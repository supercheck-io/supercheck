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

/**
 * Validates a k6 script for common issues and best practices
 */
export function validateK6Script(script: string): K6ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required: Must have k6 imports
  if (!/import\s+.*\s+from\s+['"]k6/.test(script)) {
    errors.push(
      'Script must import from k6 modules (e.g., import http from "k6/http")'
    );
  }

  // Required: Must have default export function
  if (!/export\s+default\s+function/.test(script)) {
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

  // Error: Check for async/await in default function (k6 doesn't support it UNLESS using browser module)
  // Allow async when using k6/browser or k6/experimental/browser
  if (/export\s+default\s+async\s+function/.test(script)) {
    const hasBrowserImport = /import\s+.*\s+from\s+['"]k6\/(experimental\/)?browser['"]/.test(script);
    if (!hasBrowserImport) {
      errors.push(
        'k6 does not support async/await in the default export function (unless using k6/browser or k6/experimental/browser)'
      );
    }
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
 */
export const K6_LOCATIONS = {
  'us-east': {
    code: 'us-east' as const,
    name: 'US East (Virginia)',
    region: 'North America',
    flag: '🇺🇸',
  },
  'eu-central': {
    code: 'eu-central' as const,
    name: 'EU Central (Frankfurt)',
    region: 'Europe',
    flag: '🇪🇺',
  },
  'asia-pacific': {
    code: 'asia-pacific' as const,
    name: 'Asia Pacific (Singapore)',
    region: 'Asia',
    flag: '🇸🇬',
  },
} as const;

export type K6LocationCode = keyof typeof K6_LOCATIONS;
