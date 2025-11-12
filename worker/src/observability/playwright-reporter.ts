/**
 * Custom Playwright Reporter for OpenTelemetry Integration
 *
 * This reporter creates individual spans for each test within a Playwright job,
 * providing detailed observability without modifying user test scripts.
 */

import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import { trace } from '@opentelemetry/api';
import { createSpan } from './trace-helpers';

interface TestSpanData {
  span: any;
  startTime: number;
}

class SupercheckPlaywrightReporter implements Reporter {
  private testSpans: Map<string, TestSpanData> = new Map();
  private config?: FullConfig;

  onBegin(config: FullConfig, suite: Suite) {
    this.config = config;
    console.log(`[Playwright Reporter] Starting test run with ${suite.allTests().length} tests`);
  }

  onTestBegin(test: TestCase) {
    const testTitle = test.title;
    const testId = test.id;
    const fileName = test.location.file;

    // Create a span for this individual test
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      // We're inside the Playwright Job span, create child span
      const tracer = trace.getTracer('supercheck-worker');
      const span = tracer.startSpan(`Playwright Test: ${testTitle}`, {
        attributes: {
          'test.title': testTitle,
          'test.id': testId,
          'test.file': fileName,
          'test.line': test.location.line,
          'test.column': test.location.column,
        },
      });

      this.testSpans.set(testId, {
        span,
        startTime: Date.now(),
      });

      console.log(`[Playwright Reporter] Test started: ${testTitle}`);
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const testId = test.id;
    const spanData = this.testSpans.get(testId);

    if (spanData) {
      const { span, startTime } = spanData;
      const duration = Date.now() - startTime;

      // Add test result attributes
      span.setAttribute('test.status', result.status);
      span.setAttribute('test.duration_ms', result.duration);
      span.setAttribute('test.retries', result.retry);

      if (result.error) {
        span.setAttribute('test.error', result.error.message || String(result.error));
        span.recordException(result.error);
      }

      // Set span status based on test result
      if (result.status === 'passed') {
        span.setStatus({ code: 1 }); // OK
      } else {
        span.setStatus({ code: 2, message: result.status }); // ERROR
      }

      span.end();
      this.testSpans.delete(testId);

      console.log(`[Playwright Reporter] Test ${result.status}: ${test.title} (${duration}ms)`);
    }
  }

  onEnd(result: FullResult) {
    // Close any remaining spans
    for (const [testId, spanData] of this.testSpans.entries()) {
      spanData.span.end();
    }
    this.testSpans.clear();

    console.log(`[Playwright Reporter] Test run ${result.status}`);
  }

  printsToStdio() {
    return false; // Don't interfere with Playwright's default output
  }
}

export default SupercheckPlaywrightReporter;
