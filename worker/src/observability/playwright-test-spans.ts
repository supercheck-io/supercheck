/**
 * Playwright Test Span Creation from JSON Results
 *
 * Creates individual OpenTelemetry spans for each Playwright test by parsing
 * the JSON reporter output. This approach is more robust than custom reporters
 * because it doesn't rely on cross-process context propagation.
 *
 * Usage:
 *   import { createSpansFromPlaywrightResults } from './observability/playwright-test-spans';
 *
 *   // After Playwright execution completes
 *   await createSpansFromPlaywrightResults(jsonResultsPath, parentSpanContext);
 */

import * as fs from 'fs/promises';
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { Logger } from '@nestjs/common';

interface PlaywrightTestResult {
  title: string;
  status: 'passed' | 'failed' | 'timedOut' | 'skipped';
  duration: number;
  errors?: Array<{ message?: string; stack?: string }>;
  retry: number;
}

interface PlaywrightSuiteResult {
  title: string;
  file?: string;
  line?: number;
  column?: number;
  tests?: PlaywrightTestResult[];
  suites?: PlaywrightSuiteResult[];
}

interface PlaywrightJsonReport {
  suites: PlaywrightSuiteResult[];
  stats?: {
    startTime: string;
    duration: number;
  };
}

const logger = new Logger('PlaywrightTestSpans');

/**
 * Recursively extract all tests from nested suites
 */
function extractTests(
  suite: PlaywrightSuiteResult,
  tests: Array<PlaywrightTestResult & { file?: string; line?: number; column?: number }> = [],
): Array<PlaywrightTestResult & { file?: string; line?: number; column?: number }> {
  // Add location info to tests in this suite
  if (suite.tests) {
    for (const test of suite.tests) {
      tests.push({
        ...test,
        file: suite.file,
        line: suite.line,
        column: suite.column,
      });
    }
  }

  // Recursively process nested suites
  if (suite.suites) {
    for (const nestedSuite of suite.suites) {
      extractTests(nestedSuite, tests);
    }
  }

  return tests;
}

/**
 * Create individual test spans from Playwright JSON results
 *
 * @param jsonResultsPath - Path to test-results.json file
 * @param telemetryCtx - Optional Supercheck context for span attributes
 * @param parentSpan - Optional explicit parent span (if not provided, will try to get active span)
 * @returns Number of test spans created
 *
 * @example
 * ```ts
 * const parentSpan = trace.getActiveSpan();
 * const spanCount = await createSpansFromPlaywrightResults(
 *   '/tmp/playwright-tests/test-results.json',
 *   { runId: '123', testId: 'test-abc', runType: 'playwright_job' },
 *   parentSpan
 * );
 * console.log(`Created ${spanCount} test spans`);
 * ```
 */
export async function createSpansFromPlaywrightResults(
  jsonResultsPath: string,
  telemetryCtx?: {
    runId?: string;
    testId?: string;
    jobId?: string;
    runType?: string;
    projectId?: string;
    organizationId?: string;
  },
  parentSpan?: any,
): Promise<number> {
  try {
    // Read and parse JSON results
    const jsonContent = await fs.readFile(jsonResultsPath, 'utf-8');
    const results: PlaywrightJsonReport = JSON.parse(jsonContent);

    // Extract all tests from nested suites
    const allTests: Array<PlaywrightTestResult & { file?: string; line?: number; column?: number }> = [];
    for (const suite of results.suites) {
      extractTests(suite, allTests);
    }

    if (allTests.length === 0) {
      logger.warn('No tests found in Playwright JSON results');
      return 0;
    }

    // Get the tracer
    const tracer = trace.getTracer('supercheck-worker');

    // Use provided parent span or try to get active span
    const actualParentSpan = parentSpan || trace.getActiveSpan();
    if (!actualParentSpan) {
      logger.warn('No parent span provided or active - child spans may not be properly linked');
      return 0; // Can't create child spans without a parent
    }

    // Create a context with the parent span
    const parentContext = trace.setSpan(context.active(), actualParentSpan);

    // Parse start time from stats
    const jobStartTime = results.stats?.startTime ? new Date(results.stats.startTime).getTime() : Date.now();

    let createdSpanCount = 0;
    let currentTestStartTime = jobStartTime;

    // Create a span for each test with proper timestamps
    for (const test of allTests) {
      const testStartTime = currentTestStartTime;
      const testEndTime = testStartTime + test.duration;

      // Create span with explicit start/end times and parent context
      const span = tracer.startSpan(
        `Playwright Test: ${test.title}`,
        {
          kind: SpanKind.INTERNAL,
          startTime: testStartTime,
          attributes: {
            'test.title': test.title,
            'test.status': test.status,
            'test.duration_ms': test.duration,
            'test.retries': test.retry,
            ...(test.file && { 'test.file': test.file }),
            ...(test.line && { 'test.line': test.line }),
            ...(test.column && { 'test.column': test.column }),
            // Add Supercheck context if provided
            ...(telemetryCtx?.runId && { 'sc.run_id': telemetryCtx.runId }),
            ...(telemetryCtx?.testId && { 'sc.test_id': telemetryCtx.testId }),
            ...(telemetryCtx?.jobId && { 'sc.job_id': telemetryCtx.jobId }),
            ...(telemetryCtx?.runType && { 'sc.run_type': telemetryCtx.runType }),
            ...(telemetryCtx?.projectId && { 'sc.project_id': telemetryCtx.projectId }),
            ...(telemetryCtx?.organizationId && { 'sc.organization_id': telemetryCtx.organizationId }),
          },
        },
        parentContext, // Explicitly pass parent context for proper linkage
      );

      // Add error information if test failed
      if (test.errors && test.errors.length > 0) {
        const error = test.errors[0];
        if (error.message || error.stack) {
          span.recordException({
            name: 'TestFailure',
            message: error.message || 'Test failed',
            stack: error.stack,
          });
        }
      }

      // Set span status based on test result
      if (test.status === 'passed') {
        span.setStatus({ code: SpanStatusCode.OK });
      } else if (test.status === 'skipped') {
        span.setStatus({ code: SpanStatusCode.UNSET });
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: test.status,
        });
      }

      // End span with proper timestamp
      span.end(testEndTime);
      createdSpanCount++;

      // Update start time for next test
      currentTestStartTime = testEndTime;
    }

    logger.log(`Created ${createdSpanCount} Playwright test spans from JSON results`);
    return createdSpanCount;
  } catch (error) {
    logger.error(`Failed to create spans from Playwright JSON results: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

/**
 * Check if Playwright JSON results file exists
 *
 * @param jsonResultsPath - Path to test-results.json file
 * @returns true if file exists, false otherwise
 */
export async function hasPlaywrightJsonResults(jsonResultsPath: string): Promise<boolean> {
  try {
    await fs.access(jsonResultsPath);
    return true;
  } catch {
    return false;
  }
}
