import {
  validateScriptTypeMatch,
  normalizeTestType,
  isTestTypeCompatibleWithJobType,
  getJobTestTypeMismatchError,
} from "./script-type-validator";

describe("validateScriptTypeMatch", () => {
  const k6Script = `
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 10,
  duration: '30s',
}

export default function () {
  const res = http.get('https://example.com')
  check(res, {
    'status is 200': (r) => r.status === 200,
  })
  sleep(1)
}
`;

  const playwrightScript = `
import { test, expect } from '@playwright/test'

test('homepage has title', async ({ page }) => {
  await page.goto('https://example.com')
  await expect(page).toHaveTitle(/Example/)
})
`;

  it("should accept k6 script with performance type", () => {
    const result = validateScriptTypeMatch(k6Script, "performance");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject k6 script with browser type", () => {
    const result = validateScriptTypeMatch(k6Script, "browser");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("k6 imports");
    expect(result.error).toContain('"browser"');
    expect(result.suggestedType).toBe("performance");
  });

  it("should reject k6 script with api type", () => {
    const result = validateScriptTypeMatch(k6Script, "api");
    expect(result.valid).toBe(false);
    expect(result.suggestedType).toBe("performance");
  });

  it("should reject k6 script with database type", () => {
    const result = validateScriptTypeMatch(k6Script, "database");
    expect(result.valid).toBe(false);
  });

  it("should reject k6 script with custom type", () => {
    const result = validateScriptTypeMatch(k6Script, "custom");
    expect(result.valid).toBe(false);
  });

  it("should accept playwright script with browser type", () => {
    const result = validateScriptTypeMatch(playwrightScript, "browser");
    expect(result.valid).toBe(true);
  });

  it("should accept playwright script with api type", () => {
    const result = validateScriptTypeMatch(playwrightScript, "api");
    expect(result.valid).toBe(true);
  });

  it("should accept playwright script with database type", () => {
    const result = validateScriptTypeMatch(playwrightScript, "database");
    expect(result.valid).toBe(true);
  });

  it("should accept playwright script with custom type", () => {
    const result = validateScriptTypeMatch(playwrightScript, "custom");
    expect(result.valid).toBe(true);
  });

  it("should reject playwright script with performance type", () => {
    const result = validateScriptTypeMatch(playwrightScript, "performance");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("does not contain k6 imports");
    expect(result.suggestedType).toBe("browser");
  });

  it("should accept empty script with any type", () => {
    expect(validateScriptTypeMatch("", "browser").valid).toBe(true);
    expect(validateScriptTypeMatch("", "performance").valid).toBe(true);
    expect(validateScriptTypeMatch("  ", "browser").valid).toBe(true);
  });
});

describe("normalizeTestType", () => {
  it("should normalize 'playwright' to 'browser'", () => {
    expect(normalizeTestType("playwright")).toBe("browser");
    expect(normalizeTestType("Playwright")).toBe("browser");
    expect(normalizeTestType("PLAYWRIGHT")).toBe("browser");
  });

  it("should normalize 'k6' to 'performance'", () => {
    expect(normalizeTestType("k6")).toBe("performance");
    expect(normalizeTestType("K6")).toBe("performance");
  });

  it("should normalize 'load' to 'performance'", () => {
    expect(normalizeTestType("load")).toBe("performance");
    expect(normalizeTestType("Load")).toBe("performance");
  });

  it("should pass through valid types unchanged", () => {
    expect(normalizeTestType("browser")).toBe("browser");
    expect(normalizeTestType("performance")).toBe("performance");
    expect(normalizeTestType("api")).toBe("api");
    expect(normalizeTestType("database")).toBe("database");
    expect(normalizeTestType("custom")).toBe("custom");
  });

  it("should default to 'browser' for unknown values", () => {
    expect(normalizeTestType("unknown")).toBe("browser");
    expect(normalizeTestType("")).toBe("browser");
    expect(normalizeTestType(undefined)).toBe("browser");
    expect(normalizeTestType(null)).toBe("browser");
    expect(normalizeTestType(42)).toBe("browser");
  });
});

describe("isTestTypeCompatibleWithJobType", () => {
  it("should allow browser/api/database/custom tests in playwright jobs", () => {
    expect(isTestTypeCompatibleWithJobType("browser", "playwright")).toBe(true);
    expect(isTestTypeCompatibleWithJobType("api", "playwright")).toBe(true);
    expect(isTestTypeCompatibleWithJobType("database", "playwright")).toBe(true);
    expect(isTestTypeCompatibleWithJobType("custom", "playwright")).toBe(true);
  });

  it("should reject performance tests in playwright jobs", () => {
    expect(isTestTypeCompatibleWithJobType("performance", "playwright")).toBe(false);
  });

  it("should allow performance tests in k6 jobs", () => {
    expect(isTestTypeCompatibleWithJobType("performance", "k6")).toBe(true);
  });

  it("should reject non-performance tests in k6 jobs", () => {
    expect(isTestTypeCompatibleWithJobType("browser", "k6")).toBe(false);
    expect(isTestTypeCompatibleWithJobType("api", "k6")).toBe(false);
    expect(isTestTypeCompatibleWithJobType("database", "k6")).toBe(false);
    expect(isTestTypeCompatibleWithJobType("custom", "k6")).toBe(false);
  });
});

describe("getJobTestTypeMismatchError", () => {
  it("should return error for performance test in playwright job", () => {
    const error = getJobTestTypeMismatchError("test-1", "performance", "playwright");
    expect(error).toContain("test-1");
    expect(error).toContain("performance");
    expect(error).toContain("Playwright");
  });

  it("should return error for browser test in k6 job", () => {
    const error = getJobTestTypeMismatchError("test-2", "browser", "k6");
    expect(error).toContain("test-2");
    expect(error).toContain("browser");
    expect(error).toContain("k6");
  });

  it("should return empty string for compatible combinations", () => {
    expect(getJobTestTypeMismatchError("test-3", "browser", "playwright")).toBe("");
    expect(getJobTestTypeMismatchError("test-4", "performance", "k6")).toBe("");
  });
});
