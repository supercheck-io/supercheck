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
export type SupercheckRunType = 'test' | 'job' | 'monitor' | 'k6' | 'playground';

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
  if (ctx.runType) span.setAttribute('sc.run_type', ctx.runType);

  return true;
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

/**
 * Get the W3C Trace Context traceparent header value from the current active span
 * Format: 00-{trace_id}-{span_id}-{trace_flags}
 *
 * This is used to propagate trace context to subprocesses and HTTP requests
 * to achieve end-to-end traceability across all SuperCheck components.
 *
 * @returns W3C traceparent header value, or undefined if no active span
 *
 * @example
 * ```ts
 * const traceparent = getTraceparent();
 * // Returns: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
 *
 * // Use in subprocess environment
 * spawn('playwright', args, {
 *   env: { ...process.env, TRACEPARENT: traceparent }
 * });
 * ```
 */
export function getTraceparent(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) {
    return undefined;
  }

  const spanContext = span.spanContext();

  // W3C Trace Context format: version-trace_id-span_id-trace_flags
  // version: always "00" for current spec
  // trace_id: 32 hex characters (128 bits)
  // span_id: 16 hex characters (64 bits)
  // trace_flags: 2 hex characters (8 bits) - "01" if sampled, "00" if not
  const version = '00';
  const traceId = spanContext.traceId;
  const spanId = spanContext.spanId;
  const traceFlags = (spanContext.traceFlags || 0).toString(16).padStart(2, '0');

  return `${version}-${traceId}-${spanId}-${traceFlags}`;
}

/**
 * Get trace context as environment variables for subprocess propagation
 * Returns both TRACEPARENT (W3C standard) and legacy format variables
 *
 * @returns Object with trace context environment variables
 *
 * @example
 * ```ts
 * const traceEnv = getTraceContextEnv();
 * spawn('k6', args, {
 *   env: { ...process.env, ...traceEnv }
 * });
 * ```
 */
export function getTraceContextEnv(): Record<string, string> {
  const traceparent = getTraceparent();

  if (!traceparent) {
    return {};
  }

  return {
    TRACEPARENT: traceparent,
    // Also provide individual components for easier access
    OTEL_TRACE_ID: getCurrentTraceId() || '',
    OTEL_SPAN_ID: getCurrentSpanId() || '',
  };
}
