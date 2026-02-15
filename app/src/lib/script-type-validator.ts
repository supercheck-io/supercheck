/**
 * Script-Type Cross-Validation
 * ----------------------------
 * Centralized validation to ensure a test script matches its declared type.
 * Prevents k6 scripts from being saved as browser/api/database/custom types,
 * and Playwright scripts from being saved as performance type.
 *
 * Used by:
 * - POST/PUT /api/tests (create/update)
 * - POST /api/jobs (create) and PUT /api/jobs (update) for test-type-to-job-type validation
 * - POST /api/jobs/run (execution)
 * - save-test server action
 */

import type { TestType } from "@/db/schema/types";
import { isK6Script } from "@/lib/k6-validator";

export interface ScriptTypeValidationResult {
  valid: boolean;
  error?: string;
  /** If the script type doesn't match, this is the correct type */
  suggestedType?: TestType;
}

/**
 * Validates that a test script matches its declared type.
 *
 * Rules:
 * - k6 scripts (importing from 'k6/*') MUST have type "performance"
 * - Non-k6 scripts MUST NOT have type "performance"
 */
export function validateScriptTypeMatch(
  script: string,
  declaredType: TestType
): ScriptTypeValidationResult {
  if (!script || script.trim().length === 0) {
    return { valid: true };
  }

  const scriptIsK6 = isK6Script(script);
  const isPerformanceType = declaredType === "performance";

  if (scriptIsK6 && !isPerformanceType) {
    return {
      valid: false,
      error: `Script contains k6 imports but test type is "${declaredType}". k6 performance scripts must use type "performance".`,
      suggestedType: "performance",
    };
  }

  if (!scriptIsK6 && isPerformanceType) {
    return {
      valid: false,
      error:
        'Test type is "performance" but the script does not contain k6 imports. Performance tests require k6 scripts. Use a Playwright-based test type (browser, api, database, or custom) for non-k6 scripts.',
      suggestedType: "browser",
    };
  }

  return { valid: true };
}

/**
 * Normalizes a raw type string to a valid TestType.
 * Returns the normalized type or defaults to "browser" for unknown values.
 */
export function normalizeTestType(value: unknown): TestType {
  if (typeof value !== "string") return "browser";
  const normalized = value.trim().toLowerCase();
  if (normalized === "playwright") return "browser";
  if (normalized === "k6") return "performance";
  if (normalized === "load") return "performance";
  if (
    normalized === "browser" ||
    normalized === "performance" ||
    normalized === "api" ||
    normalized === "database" ||
    normalized === "custom"
  ) {
    return normalized;
  }
  return "browser";
}

/**
 * Checks if a test type is compatible with a given job type.
 *
 * Rules:
 * - Playwright jobs: only browser, api, database, custom tests
 * - k6 jobs: only performance tests
 */
export function isTestTypeCompatibleWithJobType(
  testType: TestType,
  jobType: "playwright" | "k6"
): boolean {
  if (jobType === "k6") {
    return testType === "performance";
  }
  // Playwright jobs should NOT contain k6/performance tests
  return testType !== "performance";
}

/**
 * Returns a human-readable error for test-type/job-type mismatch.
 */
export function getJobTestTypeMismatchError(
  testId: string,
  testType: TestType,
  jobType: "playwright" | "k6"
): string {
  if (jobType === "k6" && testType !== "performance") {
    return `Test ${testId} has type "${testType}" and cannot be added to a k6 job. k6 jobs only accept performance tests.`;
  }
  if (jobType !== "k6" && testType === "performance") {
    return `Test ${testId} has type "performance" (k6) and cannot be added to a Playwright job. Playwright jobs do not support k6 performance tests.`;
  }
  return "";
}
