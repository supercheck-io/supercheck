/**
 * K6 Test Span Creation from Summary JSON
 *
 * Creates individual OpenTelemetry spans for K6 HTTP requests and scenarios
 * by parsing the summary.json output. This is a workaround for K6 versions
 * that don't support native OpenTelemetry output.
 *
 * Usage:
 *   import { createSpansFromK6Summary } from './observability/k6-test-spans';
 *
 *   // After K6 execution completes
 *   await createSpansFromK6Summary(summaryJsonPath, parentSpanContext);
 */

import * as fs from 'fs/promises';
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { Logger } from '@nestjs/common';

interface K6Metric {
  type?: string;
  contains?: string;
  // K6 v1.3.0+ metrics have properties directly, not nested in 'values'
  count?: number;
  rate?: number;
  avg?: number;
  min?: number;
  med?: number;
  max?: number;
  value?: number; // Used by VUs and other gauge metrics
  'p(90)'?: number;
  'p(95)'?: number;
  'p(99)'?: number;
}

interface K6Summary {
  root_group?: {
    name: string;
    path: string;
    id: string;
    groups?: any[];
    checks?: Array<{
      name: string;
      path: string;
      id: string;
      passes: number;
      fails: number;
    }>;
  };
  metrics: Record<string, K6Metric>;
  state?: {
    isStdOutTTY: boolean;
    isStdErrTTY: boolean;
    testRunDurationMs: number;
  };
}

const logger = new Logger('K6TestSpans');

/**
 * Create HTTP request spans from K6 summary metrics
 *
 * @param summaryJsonPath - Path to summary.json file
 * @param telemetryCtx - Optional Supercheck context for span attributes
 * @param parentSpan - Optional explicit parent span (if not provided, will try to get active span)
 * @returns Number of spans created
 *
 * @example
 * ```ts
 * const parentSpan = trace.getActiveSpan();
 * const spanCount = await createSpansFromK6Summary(
 *   '/tmp/k6-tests/summary.json',
 *   { runId: '123', testId: 'test-abc', runType: 'k6_job' },
 *   parentSpan
 * );
 * console.log(`Created ${spanCount} K6 spans`);
 * ```
 */
export async function createSpansFromK6Summary(
  summaryJsonPath: string,
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
    // Read and parse summary JSON
    const jsonContent = await fs.readFile(summaryJsonPath, 'utf-8');
    const summary: K6Summary = JSON.parse(jsonContent);

    if (!summary.metrics) {
      logger.warn('No metrics found in K6 summary JSON');
      return 0;
    }

    // Log available metric keys for debugging
    logger.log(`K6 summary metrics available: ${Object.keys(summary.metrics).join(', ')}`);
    logger.log(`K6 creating spans from ${Object.keys(summary.metrics).length} metrics`);

    const tracer = trace.getTracer('supercheck-worker');
    let createdSpanCount = 0;

    // Use provided parent span or try to get active span
    const actualParentSpan = parentSpan || trace.getActiveSpan();
    if (!actualParentSpan) {
      logger.warn('No parent span provided or active for K6 - child spans may not be properly linked');
      return 0; // Can't create child spans without a parent
    }

    // Create a context with the parent span
    const parentContext = trace.setSpan(context.active(), actualParentSpan);

    // Get test run duration from state
    const testDuration = summary.state?.testRunDurationMs || 0;
    const testStartTime = Date.now() - testDuration;

    // Create spans for HTTP requests (grouped by URL/endpoint)
    const httpMetrics = Object.entries(summary.metrics).filter(
      ([key]) => key.startsWith('http_req_') || key.includes('http_req_'),
    );

    // Create a summary span for HTTP requests if we have any
    if (httpMetrics.length > 0) {
      // Get http_reqs metric (total requests)
      const httpReqs = summary.metrics['http_reqs'];
      const httpReqDuration = summary.metrics['http_req_duration'];

      // K6 v1.3.0+ structure: metrics have properties directly, not nested in 'values'
      if (httpReqs && typeof httpReqs.count === 'number') {
        const requestCount = httpReqs.count;
        const avgDuration = httpReqDuration?.avg || 0;
        const maxDuration = httpReqDuration?.max || 0;
        const minDuration = httpReqDuration?.min || 0;
        const p95Duration = httpReqDuration?.['p(95)'] || 0;

        // Create a single span representing all HTTP requests
        const span = tracer.startSpan(
          'K6 HTTP Requests',
          {
            kind: SpanKind.CLIENT,
            startTime: testStartTime,
            attributes: {
              'http.request.count': requestCount,
              'http.duration.avg_ms': avgDuration,
              'http.duration.max_ms': maxDuration,
              'http.duration.min_ms': minDuration,
              'http.duration.p95_ms': p95Duration,
              // Add Supercheck context if provided
              ...(telemetryCtx?.runId && { 'sc.run_id': telemetryCtx.runId }),
              ...(telemetryCtx?.testId && { 'sc.test_id': telemetryCtx.testId }),
              ...(telemetryCtx?.jobId && { 'sc.job_id': telemetryCtx.jobId }),
              ...(telemetryCtx?.runType && { 'sc.run_type': telemetryCtx.runType }),
              ...(telemetryCtx?.projectId && { 'sc.project_id': telemetryCtx.projectId }),
              ...(telemetryCtx?.organizationId && {
                'sc.organization_id': telemetryCtx.organizationId,
              }),
            },
          },
          parentContext,
        );

        // Add additional HTTP metrics as attributes
        if (summary.metrics['http_req_blocked']?.avg) {
          span.setAttribute('http.blocked.avg_ms', summary.metrics['http_req_blocked'].avg);
        }
        if (summary.metrics['http_req_connecting']?.avg) {
          span.setAttribute('http.connecting.avg_ms', summary.metrics['http_req_connecting'].avg);
        }
        if (summary.metrics['http_req_sending']?.avg) {
          span.setAttribute('http.sending.avg_ms', summary.metrics['http_req_sending'].avg);
        }
        if (summary.metrics['http_req_waiting']?.avg) {
          span.setAttribute('http.waiting.avg_ms', summary.metrics['http_req_waiting'].avg);
        }
        if (summary.metrics['http_req_receiving']?.avg) {
          span.setAttribute('http.receiving.avg_ms', summary.metrics['http_req_receiving'].avg);
        }
        if (summary.metrics['http_req_failed']?.rate !== undefined) {
          const failRate = summary.metrics['http_req_failed'].rate;
          span.setAttribute('http.failure_rate', failRate);
          if (failRate > 0) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `${(failRate * 100).toFixed(2)}% of HTTP requests failed`,
            });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        span.end(testStartTime + testDuration);
        createdSpanCount++;
      } else {
        logger.log('K6: Skipping HTTP requests span - no valid http_reqs metric with count property');
      }
    } else {
      logger.log('K6: No HTTP metrics found in summary');
    }

    // Create spans for checks/assertions
    if (summary.root_group?.checks && summary.root_group.checks.length > 0) {
      for (const check of summary.root_group.checks) {
        const checkDuration = testDuration / summary.root_group.checks.length; // Approximate
        const checkStartTime = testStartTime;

        const span = tracer.startSpan(
          `K6 Check: ${check.name}`,
          {
            kind: SpanKind.INTERNAL,
            startTime: checkStartTime,
            attributes: {
              'check.name': check.name,
              'check.passes': check.passes,
              'check.fails': check.fails,
              'check.total': check.passes + check.fails,
              ...(telemetryCtx?.runId && { 'sc.run_id': telemetryCtx.runId }),
              ...(telemetryCtx?.testId && { 'sc.test_id': telemetryCtx.testId }),
              ...(telemetryCtx?.jobId && { 'sc.job_id': telemetryCtx.jobId }),
              ...(telemetryCtx?.runType && { 'sc.run_type': telemetryCtx.runType }),
              ...(telemetryCtx?.projectId && { 'sc.project_id': telemetryCtx.projectId }),
              ...(telemetryCtx?.organizationId && {
                'sc.organization_id': telemetryCtx.organizationId,
              }),
            },
          },
          parentContext,
        );

        if (check.fails > 0) {
          span.recordException({
            name: 'CheckFailure',
            message: `Check "${check.name}" failed ${check.fails} times`,
          });
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `${check.fails} failures`,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        span.end(checkStartTime + checkDuration);
        createdSpanCount++;
      }
    }

    // Create a span for VUs (Virtual Users) metrics
    if (summary.metrics['vus']) {
      const vusMetric = summary.metrics['vus'];

      // K6 v1.3.0+ structure: VUs have min/max/value directly
      if (typeof vusMetric.min === 'number' || typeof vusMetric.max === 'number') {
        const span = tracer.startSpan(
          'K6 Virtual Users',
          {
            kind: SpanKind.INTERNAL,
            startTime: testStartTime,
            attributes: {
              'vus.min': vusMetric.min || 0,
              'vus.max': vusMetric.max || 0,
              'vus.value': vusMetric.value || 0,
            ...(telemetryCtx?.runId && { 'sc.run_id': telemetryCtx.runId }),
            ...(telemetryCtx?.testId && { 'sc.test_id': telemetryCtx.testId }),
            ...(telemetryCtx?.jobId && { 'sc.job_id': telemetryCtx.jobId }),
            ...(telemetryCtx?.runType && { 'sc.run_type': telemetryCtx.runType }),
            ...(telemetryCtx?.projectId && { 'sc.project_id': telemetryCtx.projectId }),
            ...(telemetryCtx?.organizationId && {
              'sc.organization_id': telemetryCtx.organizationId,
            }),
          },
        },
        parentContext,
      );

        span.setStatus({ code: SpanStatusCode.OK });
        span.end(testStartTime + testDuration);
        createdSpanCount++;
      } else {
        logger.log('K6: Skipping VUs span - no valid min/max properties found');
      }
    }

    logger.log(`Created ${createdSpanCount} K6 spans from summary JSON`);
    return createdSpanCount;
  } catch (error) {
    logger.error(
      `Failed to create spans from K6 summary JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}

/**
 * Check if K6 summary JSON file exists
 *
 * @param summaryJsonPath - Path to summary.json file
 * @returns true if file exists, false otherwise
 */
export async function hasK6Summary(summaryJsonPath: string): Promise<boolean> {
  try {
    await fs.access(summaryJsonPath);
    return true;
  } catch {
    return false;
  }
}
