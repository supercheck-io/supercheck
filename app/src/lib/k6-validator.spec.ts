import {
  isK6Script,
  validateK6Script,
  getK6ScriptTemplate,
  K6_LOCATIONS,
  K6ValidationResult,
} from './k6-validator';

describe('K6Validator', () => {
  describe('isK6Script', () => {
    // Tests k6 script detection - critical for routing scripts to correct executor

    it('should detect k6/http imports', () => {
      // Most common k6 import pattern
      const script = `import http from 'k6/http';`;
      expect(isK6Script(script)).toBe(true);
    });

    it('should detect k6 core imports', () => {
      const script = `import { check, sleep } from 'k6';`;
      expect(isK6Script(script)).toBe(true);
    });

    it('should detect k6/metrics imports', () => {
      const script = `import { Counter, Trend } from 'k6/metrics';`;
      expect(isK6Script(script)).toBe(true);
    });

    it('should detect k6/crypto imports', () => {
      const script = `import crypto from 'k6/crypto';`;
      expect(isK6Script(script)).toBe(true);
    });

    it('should detect k6/html imports', () => {
      const script = `import { parseHTML } from 'k6/html';`;
      expect(isK6Script(script)).toBe(true);
    });

    it('should detect k6/ws imports', () => {
      const script = `import ws from 'k6/ws';`;
      expect(isK6Script(script)).toBe(true);
    });

    it('should detect k6/grpc imports', () => {
      const script = `import grpc from 'k6/grpc';`;
      expect(isK6Script(script)).toBe(true);
    });

    it('should return false for Playwright imports', () => {
      // Playwright scripts should not be detected as k6
      const script = `import { test, expect } from '@playwright/test';`;
      expect(isK6Script(script)).toBe(false);
    });

    it('should return false for Node.js scripts', () => {
      const script = `const http = require('http');`;
      expect(isK6Script(script)).toBe(false);
    });

    it('should return false for empty scripts', () => {
      expect(isK6Script('')).toBe(false);
    });

    it('should handle double quotes', () => {
      const script = `import http from "k6/http";`;
      expect(isK6Script(script)).toBe(true);
    });

    it('should handle scripts with multiple imports', () => {
      const script = `
        import http from 'k6/http';
        import { check } from 'k6';
        import { Counter } from 'k6/metrics';
      `;
      expect(isK6Script(script)).toBe(true);
    });
  });

  describe('validateK6Script', () => {
    // Tests k6 script validation for best practices and common errors

    describe('script structure validation', () => {
      it('should validate a complete valid k6 script', () => {
        // A well-formed k6 script should pass validation
        const script = `
          import http from 'k6/http';
          import { check, sleep } from 'k6';
          
          export const options = {
            vus: 10,
            duration: '30s',
            thresholds: {
              http_req_duration: ['p(95)<500'],
            },
          };
          
          export default function() {
            const response = http.get('https://test.k6.io');
            check(response, {
              'status is 200': (r) => r.status === 200,
            });
            sleep(1);
          }
        `;
        const result = validateK6Script(script, { selectedTestType: 'performance' });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should require k6 imports', () => {
        // Scripts without k6 imports should fail
        const script = `export default function() { console.log('test'); }`;
        const result = validateK6Script(script);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'This script does not import any k6 modules. Switch to a Playwright-based test type to run browser or API scripts.'
        );
      });

      it('should require default export function', () => {
        // k6 requires a default export function as entry point
        const script = `
          import http from 'k6/http';
          
          function test() {
            http.get('https://test.k6.io');
          }
        `;
        const result = validateK6Script(script);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Script must export a default function');
      });

      it('should reject async default functions', () => {
        // k6 does not support async/await in the default function
        const script = `
          import http from 'k6/http';
          
          export default async function() {
            const response = await http.get('https://test.k6.io');
          }
        `;
        const result = validateK6Script(script);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'k6 does not support async/await. For browser testing, use Playwright test type instead.'
        );
      });
    });

    describe('test type validation', () => {
      it('should accept performance test type', () => {
        const script = `
          import http from 'k6/http';
          export default function() {}
        `;
        const result = validateK6Script(script, { selectedTestType: 'performance' });
        expect(result.errors).not.toContain(expect.stringContaining('test type'));
      });

      it('should accept k6 test type', () => {
        const script = `
          import http from 'k6/http';
          export default function() {}
        `;
        const result = validateK6Script(script, { selectedTestType: 'k6' });
        expect(result.errors).not.toContain(expect.stringContaining('test type'));
      });

      it('should reject k6 scripts with wrong test type', () => {
        // k6 scripts should only run with performance/k6 test types
        const script = `
          import http from 'k6/http';
          export default function() {}
        `;
        const result = validateK6Script(script, { selectedTestType: 'e2e' });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'k6 scripts can only run when the test type is set to Performance. Current type: "e2e".'
        );
      });

      it('should be case-insensitive for test type', () => {
        const script = `
          import http from 'k6/http';
          export default function() {}
        `;
        const result = validateK6Script(script, { selectedTestType: 'PERFORMANCE' });
        expect(result.errors).not.toContain(expect.stringContaining('test type is set to Performance'));
      });
    });

    describe('forbidden modules', () => {
      it('should reject fs module', () => {
        // Node.js fs module is not available in k6
        const script = `
          import http from 'k6/http';
          import fs from 'fs';
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.errors).toContain(
          'k6 does not support Node.js module "fs". Use k6 built-in modules instead.'
        );
      });

      it('should reject path module', () => {
        const script = `
          import http from 'k6/http';
          import path from 'path';
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.errors).toContain(
          'k6 does not support Node.js module "path". Use k6 built-in modules instead.'
        );
      });

      it('should reject child_process module', () => {
        const script = `
          import http from 'k6/http';
          import { exec } from 'child_process';
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.errors).toContain(
          'k6 does not support Node.js module "child_process". Use k6 built-in modules instead.'
        );
      });

      it('should reject Node.js http module (not k6/http)', () => {
        const script = `
          import k6http from 'k6/http';
          import http from 'http';
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.errors).toContain(
          'k6 does not support Node.js module "http". Use k6 built-in modules instead.'
        );
      });

      it('should reject Node.js crypto module', () => {
        // k6 has its own k6/crypto module
        const script = `
          import http from 'k6/http';
          import crypto from 'crypto';
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.errors).toContain(
          'k6 does not support Node.js module "crypto". Use k6 built-in modules instead.'
        );
      });

      it('should reject require syntax for Node.js modules', () => {
        const script = `
          import http from 'k6/http';
          const fs = require('fs');
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.errors).toContain(
          'k6 does not support Node.js module "fs". Use k6 built-in modules instead.'
        );
      });
    });

    describe('Playwright detection', () => {
      it('should reject @playwright/test imports', () => {
        const script = `
          import http from 'k6/http';
          import { test } from '@playwright/test';
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.errors).toContain(
          'Playwright modules are not supported in k6 performance scripts. Split Playwright tests into a Browser test.'
        );
      });

      it('should reject playwright imports', () => {
        const script = `
          import http from 'k6/http';
          import { chromium } from 'playwright';
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.errors).toContain(
          'Playwright modules are not supported in k6 performance scripts. Split Playwright tests into a Browser test.'
        );
      });
    });

    describe('k6/browser module', () => {
      it('should reject k6/browser imports', () => {
        // k6/browser is experimental and not supported in our runtime
        const script = `
          import http from 'k6/http';
          import browser from 'k6/browser';
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.errors).toContain(
          'The k6/browser module is not supported. Use Playwright tests for browser automation.'
        );
      });
    });

    describe('warnings', () => {
      it('should warn about missing options export', () => {
        const script = `
          import http from 'k6/http';
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.warnings).toContain(
          'Consider adding "export const options" to configure VUs, duration, and thresholds'
        );
      });

      it('should warn about console.log usage', () => {
        const script = `
          import http from 'k6/http';
          export default function() {
            console.log('debug');
          }
        `;
        const result = validateK6Script(script);
        expect(result.warnings).toContain(
          'Consider using k6 check() functions instead of console.log() for validation'
        );
      });

      it('should warn about missing thresholds', () => {
        const script = `
          import http from 'k6/http';
          export const options = {
            vus: 10,
            duration: '30s',
          };
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.warnings).toContain(
          'Consider adding thresholds to define pass/fail criteria for your test'
        );
      });

      it('should not warn about thresholds when they are defined', () => {
        const script = `
          import http from 'k6/http';
          export const options = {
            vus: 10,
            duration: '30s',
            thresholds: {
              http_req_duration: ['p(95)<500'],
            },
          };
          export default function() {}
        `;
        const result = validateK6Script(script);
        expect(result.warnings).not.toContain(
          expect.stringContaining('thresholds')
        );
      });
    });
  });

  describe('getK6ScriptTemplate', () => {
    // Tests template generation for new k6 scripts

    it('should return a valid k6 script template', () => {
      const template = getK6ScriptTemplate();
      
      // Template should pass validation
      const result = validateK6Script(template, { selectedTestType: 'performance' });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should include k6/http import', () => {
      const template = getK6ScriptTemplate();
      expect(template).toContain("import http from 'k6/http'");
    });

    it('should include check and sleep imports', () => {
      const template = getK6ScriptTemplate();
      expect(template).toContain("import { check, sleep } from 'k6'");
    });

    it('should include options export', () => {
      const template = getK6ScriptTemplate();
      expect(template).toContain('export const options');
    });

    it('should include thresholds', () => {
      const template = getK6ScriptTemplate();
      expect(template).toContain('thresholds');
    });

    it('should include default export function', () => {
      const template = getK6ScriptTemplate();
      expect(template).toContain('export default function');
    });

    it('should include example http.get call', () => {
      const template = getK6ScriptTemplate();
      expect(template).toContain('http.get');
    });

    it('should include example check call', () => {
      const template = getK6ScriptTemplate();
      expect(template).toContain('check(response');
    });
  });

  describe('K6_LOCATIONS', () => {
    // Tests location configuration constants

    it('should have US_EAST location', () => {
      expect(K6_LOCATIONS.US_EAST).toBeDefined();
      expect(K6_LOCATIONS.US_EAST.code).toBe('us-east');
      expect(K6_LOCATIONS.US_EAST.name).toBe('US East');
    });

    it('should have EU_CENTRAL location', () => {
      expect(K6_LOCATIONS.EU_CENTRAL).toBeDefined();
      expect(K6_LOCATIONS.EU_CENTRAL.code).toBe('eu-central');
      expect(K6_LOCATIONS.EU_CENTRAL.name).toBe('EU Central');
    });

    it('should have ASIA_PACIFIC location', () => {
      expect(K6_LOCATIONS.ASIA_PACIFIC).toBeDefined();
      expect(K6_LOCATIONS.ASIA_PACIFIC.code).toBe('asia-pacific');
      expect(K6_LOCATIONS.ASIA_PACIFIC.name).toBe('Asia Pacific');
    });

    it('should have region information for each location', () => {
      expect(K6_LOCATIONS.US_EAST.region).toBeDefined();
      expect(K6_LOCATIONS.EU_CENTRAL.region).toBeDefined();
      expect(K6_LOCATIONS.ASIA_PACIFIC.region).toBeDefined();
    });

    it('should have flag emoji for each location', () => {
      expect(K6_LOCATIONS.US_EAST.flag).toBeDefined();
      expect(K6_LOCATIONS.EU_CENTRAL.flag).toBeDefined();
      expect(K6_LOCATIONS.ASIA_PACIFIC.flag).toBeDefined();
    });
  });
});
