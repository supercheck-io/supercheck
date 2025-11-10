/**
 * Execution Span Processor
 *
 * Filters spans to only export test/job/monitor execution-related spans.
 * This removes noise from infrastructure operations (S3, Redis, DB, HTTP client calls)
 * and focuses on what users care about: their test executions.
 *
 * Spans are included if they meet ANY of these criteria:
 * 1. Have execution context (sc.run_id, sc.job_id, sc.monitor_id)
 * 2. Are root spans for executions (test.execute, job.execute, k6.execute)
 * 3. Come from external instrumented applications (have traceparent correlation)
 * 4. Have ERROR status (always show errors for debugging)
 */

import {
  SpanProcessor,
  ReadableSpan,
  Span,
} from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode } from '@opentelemetry/api';
import { Context } from '@opentelemetry/api';

/**
 * Configuration for execution span filtering
 */
export interface ExecutionSpanFilterConfig {
  /**
   * If true, filter spans to only show execution-related spans
   * @default true
   */
  enableFiltering: boolean;

  /**
   * Always allow ERROR spans regardless of context
   * @default true
   */
  alwaysShowErrors: boolean;

  /**
   * Span names that should always be included
   * Patterns support wildcards (*)
   * @default ['*.execute', 'test.*', 'job.*', 'k6.*', 'monitor.*', 'playwright.*']
   */
  allowedSpanPatterns: string[];

  /**
   * Span names that should always be excluded
   * These are infrastructure operations we don't want to see
   * @default ['publish', 'S3.*', 'Redis.*', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH']
   */
  excludedSpanPatterns: string[];

  /**
   * Attributes that indicate this is an execution span
   * If ANY of these attributes are present, the span is included
   * @default ['sc.run_id', 'sc.job_id', 'sc.monitor_id', 'sc.test_id']
   */
  executionAttributes: string[];

  /**
   * If true, spans from external apps (different service.name) are included
   * @default true
   */
  includeExternalAppSpans: boolean;
}

const DEFAULT_CONFIG: ExecutionSpanFilterConfig = {
  enableFiltering: true,
  alwaysShowErrors: true,
  allowedSpanPatterns: [
    '*.execute',
    'test.*',
    'job.*',
    'k6.*',
    'monitor.*',
    'playwright.*',
  ],
  excludedSpanPatterns: [
    'publish',
    'S3.*',
    'Redis.*',
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'HEAD',
    'OPTIONS',
    'PutObject',
    'GetObject',
    'ListObjectsV2',
    'ListObjects',
    'DeleteObject',
    'HeadObject',
  ],
  executionAttributes: ['sc.run_id', 'sc.job_id', 'sc.monitor_id', 'sc.test_id'],
  includeExternalAppSpans: true,
};

/**
 * Custom SpanProcessor that filters spans to only show execution-related spans
 */
export class ExecutionSpanProcessor implements SpanProcessor {
  private readonly config: ExecutionSpanFilterConfig;
  private readonly wrappedProcessor: SpanProcessor;

  constructor(
    wrappedProcessor: SpanProcessor,
    config?: Partial<ExecutionSpanFilterConfig>,
  ) {
    this.wrappedProcessor = wrappedProcessor;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a string matches a pattern with wildcards
   */
  private matchesPattern(str: string, pattern: string): boolean {
    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
      .replace(/\*/g, '.*'); // Convert * to .*
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(str);
  }

  /**
   * Determine if a span should be included based on filtering rules
   */
  private shouldIncludeSpan(span: ReadableSpan): boolean {
    // If filtering is disabled, include everything
    if (!this.config.enableFiltering) {
      return true;
    }

    const spanName = span.name;
    const attributes = span.attributes;

    // Always show ERROR spans for debugging
    if (this.config.alwaysShowErrors) {
      if (span.status.code === SpanStatusCode.ERROR) {
        return true;
      }
    }

    // Check if span name matches excluded patterns (Redis publish, S3, HTTP)
    const isExcluded = this.config.excludedSpanPatterns.some((pattern) =>
      this.matchesPattern(spanName, pattern),
    );
    if (isExcluded) {
      return false;
    }

    // Check if span has execution context attributes
    const hasExecutionContext = this.config.executionAttributes.some(
      (attr) => attributes[attr] !== undefined,
    );
    if (hasExecutionContext) {
      return true;
    }

    // Check if span name matches allowed patterns
    const isAllowed = this.config.allowedSpanPatterns.some((pattern) =>
      this.matchesPattern(spanName, pattern),
    );
    if (isAllowed) {
      return true;
    }

    // Check if this is from an external instrumented app
    if (this.config.includeExternalAppSpans) {
      const serviceName = attributes['service.name'] as string | undefined;
      const isExternalApp =
        serviceName && !serviceName.includes('supercheck-worker');

      if (isExternalApp) {
        return true;
      }
    }

    // Check for K6 or Playwright specific attributes
    if (attributes['k6.run_id'] || attributes['playwright.run_id']) {
      return true;
    }

    // Default: exclude the span
    return false;
  }

  onStart(span: Span, parentContext: Context): void {
    // Forward to wrapped processor
    this.wrappedProcessor.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    // Only forward to wrapped processor if span should be included
    if (this.shouldIncludeSpan(span)) {
      this.wrappedProcessor.onEnd(span);
    }
    // Otherwise, silently drop the span
  }

  async forceFlush(): Promise<void> {
    return this.wrappedProcessor.forceFlush();
  }

  async shutdown(): Promise<void> {
    return this.wrappedProcessor.shutdown();
  }
}

/**
 * Create a filtered span processor
 * Wraps a BatchSpanProcessor with execution span filtering
 */
export function createExecutionSpanProcessor(
  wrappedProcessor: SpanProcessor,
  config?: Partial<ExecutionSpanFilterConfig>,
): ExecutionSpanProcessor {
  return new ExecutionSpanProcessor(wrappedProcessor, config);
}
