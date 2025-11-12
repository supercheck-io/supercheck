/**
 * Supercheck Trace Helpers
 *
 * Utility functions for adding Supercheck-specific attributes to OpenTelemetry spans.
 * This enables correlation between traces and Supercheck entities (runs, tests, jobs, monitors).
 *
 * Usage:
 *   import { addSupcheckRunContext, createSpan } from './observability/trace-helpers';
 *
 *   // Add context to current span
 *   addSupcheckRunContext({ runId: '123', testId: 'test-abc', runType: 'test' });
 *
 *   // Create custom span
 *   await createSpan('playwright-test', async (span) => {
 *     span.setAttribute('test.name', 'Login Test');
 *     await executeTest();
 *   });
 */

import { trace, context, Span, SpanStatusCode } from '@opentelemetry/api';

/**
 * Supercheck entity types for trace correlation
 */
export type SupercheckRunType =
  | 'test'
  | 'job'
  | 'monitor'
  | 'k6'
  | 'playground'
  | 'playwright_job'
  | 'playwright_test'
  | 'k6_job'
  | 'k6_test';

/**
 * Supercheck context that can be attached to spans
 */
export interface SupercheckContext {
  runId?: string;
  testId?: string;
  testName?: string;
  jobId?: string;
  jobName?: string;
  monitorId?: string;
  monitorName?: string;
  projectId?: string;
  organizationId?: string;
  runType?: SupercheckRunType;
}

/**
 * Add Supercheck-specific attributes to the current active span
 * This enables filtering and correlation in the observability UI
 *
 * @param ctx - Supercheck context to add to the span
 * @returns true if context was added, false if no active span
 *
 * @example
 * ```ts
 * addSupcheckRunContext({
 *   runId: '01JCABCD...',
 *   testId: 'test-123',
 *   testName: 'Login Flow Test',
 *   runType: 'test',
 *   projectId: 'proj-456',
 *   organizationId: 'org-789'
 * });
 * ```
 */
export function addSupcheckRunContext(ctx: SupercheckContext): boolean {
  const span = trace.getActiveSpan();
  if (!span) {
    return false;
  }

  // Add attributes with 'sc.' prefix for easy filtering
  if (ctx.runId) span.setAttribute('sc.run_id', ctx.runId);
  if (ctx.testId) span.setAttribute('sc.test_id', ctx.testId);
  if (ctx.testName) span.setAttribute('sc.test_name', ctx.testName);
  if (ctx.jobId) span.setAttribute('sc.job_id', ctx.jobId);
  if (ctx.jobName) span.setAttribute('sc.job_name', ctx.jobName);
  if (ctx.monitorId) span.setAttribute('sc.monitor_id', ctx.monitorId);
  if (ctx.monitorName) span.setAttribute('sc.monitor_name', ctx.monitorName);
  if (ctx.projectId) span.setAttribute('sc.project_id', ctx.projectId);
  if (ctx.organizationId) span.setAttribute('sc.organization_id', ctx.organizationId);
  if (ctx.runType) {
    span.setAttribute('sc.run_type', ctx.runType);
    // Also set display name based on run type for trace UI consistency
    const displayName = getDisplayNameForRunType(ctx.runType);
    if (displayName) {
      span.setAttribute('sc.display_name', displayName);
    }
  }

  return true;
}

/**
 * Get display-friendly name for run type
 */
function getDisplayNameForRunType(runType: SupercheckRunType): string {
  const nameMap: Record<SupercheckRunType, string> = {
    'playwright_job': 'Playwright Job',
    'playwright_test': 'Playwright Test',
    'k6_job': 'K6 Job',
    'k6_test': 'K6 Test',
    'job': 'Job',
    'test': 'Test',
    'k6': 'K6',
    'monitor': 'Monitor',
    'playground': 'Playground',
  };
  return nameMap[runType] || runType;
}

/**
 * Create a custom span with automatic error handling and status management
 *
 * @param name - Name of the span (e.g., 'playwright-test', 'upload-artifacts')
 * @param fn - Async function to execute within the span context
 * @param attributes - Optional initial attributes for the span
 * @returns Result of the function execution
 *
 * @example
 * ```ts
 * const result = await createSpan('upload-test-results', async (span) => {
 *   span.setAttribute('file.size', fileSize);
 *   span.setAttribute('s3.bucket', bucketName);
 *   return await uploadToS3(file);
 * }, { 'upload.type': 'playwright-report' });
 * ```
 */
export async function createSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const tracer = trace.getTracer('supercheck-worker');

  return tracer.startActiveSpan(name, async (span) => {
    try {
      // Add initial attributes if provided
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          span.setAttribute(key, value);
        });
      }

      // Execute function
      const result = await fn(span);

      // Mark span as successful
      span.setStatus({ code: SpanStatusCode.OK });

      return result;
    } catch (error) {
      // Record exception and mark span as failed
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });

      // Re-throw error to maintain original behavior
      throw error;
    } finally {
      // Always end the span
      span.end();
    }
  });
}

/**
 * Create a span with Supercheck context automatically added
 *
 * @param name - Name of the span
 * @param ctx - Supercheck context to add
 * @param fn - Async function to execute
 * @param attributes - Optional initial attributes
 * @returns Result of the function execution
 *
 * @example
 * ```ts
 * await createSpanWithContext('execute-playwright-test', {
 *   runId: '01JCABCD...',
 *   testId: 'test-123',
 *   runType: 'test'
 * }, async (span) => {
 *   span.setAttribute('browser', 'chromium');
 *   await runPlaywrightTest();
 * });
 * ```
 */
export async function createSpanWithContext<T>(
  name: string,
  ctx: SupercheckContext,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return createSpan(name, async (span) => {
    // Set span name as attribute for trace UI
    span.setAttribute('span.name', name);

    // Also set as generic 'name' attribute for trace list display
    span.setAttribute('name', name);

    // Set trace-level display name for trace list UI
    const spanContext = span.spanContext();
    if (spanContext.traceFlags) {
      // This span is part of a sampled trace
      span.setAttribute('trace.name', name);
    }

    // Add Supercheck context
    addSupcheckRunContext(ctx);

    // Execute function
    return fn(span);
  }, attributes);
}

/**
 * Get the current trace ID
 * Useful for logging and correlation
 *
 * @returns Trace ID as hex string, or undefined if no active span
 */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) {
    return undefined;
  }

  const spanContext = span.spanContext();
  return spanContext.traceId;
}

/**
 * Get the current span ID
 *
 * @returns Span ID as hex string, or undefined if no active span
 */
export function getCurrentSpanId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) {
    return undefined;
  }

  const spanContext = span.spanContext();
  return spanContext.spanId;
}

/**
 * Check if observability is enabled and there's an active span
 *
 * @returns true if tracing is active, false otherwise
 */
export function isTracingActive(): boolean {
  return trace.getActiveSpan() !== undefined;
}

/**
 * Add custom attributes to the current active span
 * Convenience method for adding multiple attributes at once
 *
 * @param attributes - Object with key-value pairs to add as attributes
 * @returns true if attributes were added, false if no active span
 *
 * @example
 * ```ts
 * addSpanAttributes({
 *   'test.duration': 1234,
 *   'test.status': 'passed',
 *   'test.retries': 0
 * });
 * ```
 */
export function addSpanAttributes(attributes: Record<string, string | number | boolean>): boolean {
  const span = trace.getActiveSpan();
  if (!span) {
    return false;
  }

  Object.entries(attributes).forEach(([key, value]) => {
    span.setAttribute(key, value);
  });

  return true;
}

/**
 * Record an exception on the current active span
 * Useful for error tracking without failing the span
 *
 * @param error - Error to record
 * @param fatal - If true, also sets span status to ERROR
 * @returns true if exception was recorded, false if no active span
 */
export function recordSpanException(error: Error, fatal = true): boolean {
  const span = trace.getActiveSpan();
  if (!span) {
    return false;
  }

  span.recordException(error);

  if (fatal) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }

  return true;
}

/**
 * Add an event to the current active span
 * Events are timestamped log messages attached to a span
 *
 * @param name - Event name
 * @param attributes - Optional attributes for the event
 * @returns true if event was added, false if no active span
 *
 * @example
 * ```ts
 * addSpanEvent('test.step.completed', {
 *   'step.name': 'login',
 *   'step.duration': 234
 * });
 * ```
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): boolean {
  const span = trace.getActiveSpan();
  if (!span) {
    return false;
  }

  span.addEvent(name, attributes);
  return true;
}
