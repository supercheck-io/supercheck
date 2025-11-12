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
  status: 'passed' | 'failed' | 'timedOut' | 'skipped';
  duration: number;
  startTime?: string;
  errors?: Array<{ message?: string; stack?: string }>;
}

interface PlaywrightTest {
  results: PlaywrightTestResult[];
}

interface PlaywrightSpec {
  title: string;
  file?: string;
  line?: number;
  column?: number;
  tests: PlaywrightTest[];
}

interface PlaywrightSuiteResult {
  title?: string;
  specs?: PlaywrightSpec[];
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
 * Recursively extract all test specs from nested suites
 */
function extractSpecs(
  suite: PlaywrightSuiteResult,
  specs: Array<PlaywrightSpec> = [],
): Array<PlaywrightSpec> {
  // Add specs from this suite
  if (suite.specs) {
    for (const spec of suite.specs) {
      specs.push(spec);
    }
  }

  // Recursively process nested suites
  if (suite.suites) {
    for (const nestedSuite of suite.suites) {
      extractSpecs(nestedSuite, specs);
    }
  }

  return specs;
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

    // Extract all specs from nested suites
    const allSpecs: Array<PlaywrightSpec> = [];
    for (const suite of results.suites) {
      extractSpecs(suite, allSpecs);
    }

    if (allSpecs.length === 0) {
      logger.warn('No specs found in Playwright JSON results');
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

    // Create a span for each spec (test definition) with all its retries
    for (const spec of allSpecs) {
      // Get the final result (last result in the array, after all retries)
      if (spec.tests.length === 0 || spec.tests[0].results.length === 0) {
        continue;
      }

      const testRun = spec.tests[0]; // First test run object (contains all retries)
      const finalResult = testRun.results[testRun.results.length - 1]; // Last result after retries
      const firstResult = testRun.results[0]; // First attempt

      // Use startTime from first result, or fallback to job start time
      const testStartTime = firstResult.startTime
        ? new Date(firstResult.startTime).getTime()
        : jobStartTime;
      const testDuration = finalResult.duration || 0;
      const testEndTime = testStartTime + testDuration;

      // Determine overall status (flaky if multiple attempts, use final status)
      const status = testRun.results.length > 1
        ? (finalResult.status === 'passed' ? 'flaky' : finalResult.status)
        : finalResult.status;

      // Create span with explicit start/end times and parent context
      const span = tracer.startSpan(
        `Playwright Test: ${spec.title}`,
        {
          kind: SpanKind.INTERNAL,
          startTime: testStartTime,
          attributes: {
            'test.title': spec.title,
            'test.status': status,
            'test.duration_ms': testDuration,
            'test.retries': testRun.results.length - 1,
            ...(spec.file && { 'test.file': spec.file }),
            ...(spec.line && { 'test.line': spec.line }),
            ...(spec.column && { 'test.column': spec.column }),
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
      if (finalResult.errors && finalResult.errors.length > 0) {
        const error = finalResult.errors[0];
        if (error.message || error.stack) {
          span.recordException({
            name: 'TestFailure',
            message: error.message || 'Test failed',
            stack: error.stack,
          });
        }
      }

      // Set span status based on test result
      if (status === 'passed' || status === 'flaky') {
        span.setStatus({ code: SpanStatusCode.OK });
      } else if (status === 'skipped') {
        span.setStatus({ code: SpanStatusCode.UNSET });
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: status,
        });
      }

      // End span with proper timestamp
      span.end(testEndTime);
      createdSpanCount++;
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
