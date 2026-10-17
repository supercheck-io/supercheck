/** @jest-environment node */

import {
  PlaywrightValidationService,
  playwrightValidationService,
} from "./playwright-validator";

const service = new PlaywrightValidationService();

const VALID_PLAYWRIGHT_SCRIPT = `import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});`;

const VALID_K6_SCRIPT = `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 1, duration: '1s' };

export default function () {
  const res = http.get('https://example.com');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}`;

describe("playwright-validator", () => {
  describe("input validation", () => {
    it("rejects empty input", () => {
      const result = service.validateCode("");

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("syntax");
      expect(result.error).toContain("Invalid script content");
    });

    it("rejects non-string input", () => {
      const result = service.validateCode(null as unknown as string);

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("syntax");
    });

    it("rejects scripts over the shared submission limit", () => {
      const result = service.validateCode("a".repeat(1_000_001));

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("length");
      expect(result.error).toContain("Script too long");
    });
  });

  describe("test type routing", () => {
    it("accepts a valid Playwright script with no selected type", () => {
      expect(service.validateCode(VALID_PLAYWRIGHT_SCRIPT)).toEqual({
        valid: true,
      });
    });

    it("accepts a k6 script when the test type is performance", () => {
      expect(
        service.validateCode(VALID_K6_SCRIPT, {
          selectedTestType: "performance",
        }),
      ).toEqual({ valid: true });
    });

    it("accepts a k6 script when the test type is k6 (case-insensitive)", () => {
      // "k6" is accepted by the validator's normalisation but is not part of
      // the persisted TestType union, so the option is cast here.
      expect(
        service.validateCode(VALID_K6_SCRIPT, {
          selectedTestType: "k6" as never,
        }),
      ).toEqual({ valid: true });
      expect(
        service.validateCode(VALID_K6_SCRIPT, {
          selectedTestType: "PERFORMANCE" as never,
        }),
      ).toEqual({ valid: true });
    });

    it("rejects a k6 script when the test type is not performance", () => {
      const result = service.validateCode(VALID_K6_SCRIPT, {
        selectedTestType: "browser",
      });

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("type");
      expect(result.error).toContain("k6 imports");
    });

    it("rejects a Playwright script when the test type is performance", () => {
      const result = service.validateCode(VALID_PLAYWRIGHT_SCRIPT, {
        selectedTestType: "performance",
      });

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("type");
      expect(result.error).toContain("does not contain k6 imports");
    });

    it("surfaces k6 validation errors for invalid k6 scripts", () => {
      const result = service.validateCode(
        `import http from 'k6/http';\nexport default function() { readFile('DATA'); }`,
        { selectedTestType: "performance" },
      );

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("type");
    });
  });

  describe("runtime isolation rather than static deny-lists", () => {
    it.each([
      `import fs from 'node:fs'; console.log(fs.existsSync('/tmp'));`,
      `const fs = await import('node:fs');`,
      `const p = ([]).constructor.constructor('return process')();`,
      `decodeURI('%20'); new ArrayBuffer(8); setTimeout(() => {}, 0);`,
    ])("accepts supported JavaScript for isolated execution: %s", (script) => {
      expect(service.validateCode(script)).toEqual({ valid: true });
    });
  });

  describe("complexity limits", () => {
    it("rejects scripts with more than 1000 statements", () => {
      const script = "a++;".repeat(1001);

      const result = service.validateCode(script);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Script too complex");
    });

    it("accepts scripts below the statement limit", () => {
      const script = "a++;".repeat(100);

      expect(service.validateCode(script)).toEqual({ valid: true });
    });
  });

  describe("syntax errors", () => {
    it("rejects code that does not parse", () => {
      const result = service.validateCode("const x = ;");

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("syntax");
      expect(result.error).toContain("Syntax error");
    });

    it("accepts TypeScript syntax via transpilation", () => {
      const result = service.validateCode(
        `import { test } from '@playwright/test';\n\nconst value: string = 'ok';\ntest('x', async () => { console.log(value); });`,
      );

      expect(result).toEqual({ valid: true });
    });
  });

  it("exports the shared validator instance", () => {
    expect(
      playwrightValidationService.validateCode(VALID_PLAYWRIGHT_SCRIPT),
    ).toEqual({ valid: true });
  });
});
