import { trace, context, SpanStatusCode, type Span } from '@opentelemetry/api';
import * as fs from 'fs';
import * as readline from 'readline';
import { Logger } from '../utils/logger';

const logger = new Logger('K6JSONParser');

/**
 * K6 NDJSON output format interfaces
 */
interface K6Metric {
  type: 'Metric' | 'Point';
  data: {
    time: string;
    value: number;
    tags?: Record<string, string>;
  };
  metric: string;
}

/**
 * Aggregated HTTP endpoint metrics
 */
interface EndpointMetrics {
  url: string; // Normalized URL pattern
  method: string;
  requestCount: number;
  totalDuration: number;
  minDuration: number;
  maxDuration: number;
  p95Duration?: number;
  p99Duration?: number;
  durations: number[]; // For percentile calculation
  statusCodes: Record<string, number>; // Count by status code
  errorCount: number;
  firstRequestTime?: number;
  lastRequestTime?: number;
}

/**
 * Scenario execution metrics
 */
interface ScenarioMetrics {
  name: string;
  iterations: number;
  duration: number;
  vus: number[];
  firstIterationTime?: number;
  lastIterationTime?: number;
}

/**
 * Check result metrics
 */
interface CheckMetrics {
  name: string;
  passes: number;
  fails: number;
}

/**
 * Configuration for K6 JSON parsing
 */
interface K6ParserConfig {
  /** Enable intelligent aggregation by endpoint */
  aggregateByEndpoint?: boolean;
  /** Create scenario-level spans */
  includeScenarios?: boolean;
  /** Create check-level spans */
  includeChecks?: boolean;
  /** Sample slow requests (top N slowest) */
  sampleSlowRequests?: number;
  /** Sample failed requests */
  sampleFailedRequests?: boolean;
}

/**
 * Normalize URL to create endpoint patterns
 * Converts /api/users/123 -> /api/users/{id}
 */
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname;

    // Replace UUIDs with {uuid}
    pathname = pathname.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '{uuid}',
    );

    // Replace numeric IDs with {id}
    pathname = pathname.replace(/\/\d+/g, '/{id}');

    // Replace hex strings (longer than 8 chars) with {hash}
    pathname = pathname.replace(/\/[0-9a-f]{9,}/gi, '/{hash}');

    // Include query params placeholder if present
    const query = urlObj.search ? '?...' : '';

    return `${urlObj.origin}${pathname}${query}`;
  } catch {
    // If URL parsing fails, try simple pattern matching
    let normalized = url;

    // Replace UUIDs
    normalized = normalized.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '{uuid}',
    );

    // Replace numeric IDs
    normalized = normalized.replace(/\/\d+/g, '/{id}');

    return normalized;
  }
}

/**
 * Calculate percentile from sorted array
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;

  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

/**
 * Parse K6 JSON output and create aggregated OpenTelemetry spans
 *
 * @param jsonOutputPath - Path to the K6 JSON output file (NDJSON format)
 * @param telemetryCtx - Telemetry context with trace/span IDs for correlation
 * @param parentSpan - Parent span for proper trace hierarchy
 * @param testStartTime - Start time of the K6 test execution
 * @param config - Configuration options for parsing
 * @returns Number of spans created
 */
export async function createSpansFromK6JSON(
  jsonOutputPath: string,
  telemetryCtx?: { traceId?: string; spanId?: string },
  parentSpan?: Span,
  testStartTime?: number,
  config: K6ParserConfig = {},
): Promise<number> {
  const finalConfig: Required<K6ParserConfig> = {
    aggregateByEndpoint: config.aggregateByEndpoint ?? true,
    includeScenarios: config.includeScenarios ?? true,
    includeChecks: config.includeChecks ?? true,
    sampleSlowRequests: config.sampleSlowRequests ?? 0,
    sampleFailedRequests: config.sampleFailedRequests ?? true,
  };

  try {
    // Check if JSON output file exists
    if (!fs.existsSync(jsonOutputPath)) {
      logger.warn(`K6 JSON output file not found: ${jsonOutputPath}`);
      return 0;
    }

    logger.log(`Parsing K6 JSON output: ${jsonOutputPath}`);

    // Data structures for aggregation
    const endpointMetrics = new Map<string, EndpointMetrics>();
    const scenarioMetrics = new Map<string, ScenarioMetrics>();
    const checkMetrics = new Map<string, CheckMetrics>();
    const slowRequests: Array<{ url: string; method: string; duration: number; time: number }> = [];
    const failedRequests: Array<{ url: string; method: string; status: number; time: number }> = [];

    // Parse NDJSON file line by line
    const fileStream = fs.createReadStream(jsonOutputPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineCount = 0;
    let minTime: number | undefined;
    let maxTime: number | undefined;

    for await (const line of rl) {
      lineCount++;

      try {
        const metric: K6Metric = JSON.parse(line);

        if (metric.type !== 'Point') {
          continue; // Skip non-point metrics
        }

        const timestamp = new Date(metric.data.time).getTime();
        if (!minTime || timestamp < minTime) minTime = timestamp;
        if (!maxTime || timestamp > maxTime) maxTime = timestamp;

        // Process HTTP request metrics
        if (metric.metric === 'http_req_duration' && metric.data.tags) {
          const tags = metric.data.tags;
          const url = tags.url || tags.name || 'unknown';
          const method = tags.method || 'GET';
          const status = tags.status || '200';
          const duration = metric.data.value; // in milliseconds

          // Normalize URL for aggregation
          const normalizedUrl = normalizeUrl(url);
          const endpointKey = `${method}:${normalizedUrl}`;

          // Get or create endpoint metrics
          let endpoint = endpointMetrics.get(endpointKey);
          if (!endpoint) {
            endpoint = {
              url: normalizedUrl,
              method,
              requestCount: 0,
              totalDuration: 0,
              minDuration: Infinity,
              maxDuration: 0,
              durations: [],
              statusCodes: {},
              errorCount: 0,
            };
            endpointMetrics.set(endpointKey, endpoint);
          }

          // Update metrics
          endpoint.requestCount++;
          endpoint.totalDuration += duration;
          endpoint.minDuration = Math.min(endpoint.minDuration, duration);
          endpoint.maxDuration = Math.max(endpoint.maxDuration, duration);
          endpoint.durations.push(duration);
          endpoint.statusCodes[status] = (endpoint.statusCodes[status] || 0) + 1;

          if (parseInt(status) >= 400) {
            endpoint.errorCount++;
          }

          if (!endpoint.firstRequestTime) {
            endpoint.firstRequestTime = timestamp;
          }
          endpoint.lastRequestTime = timestamp;

          // Track slow requests for sampling
          if (finalConfig.sampleSlowRequests > 0) {
            slowRequests.push({ url, method, duration, time: timestamp });
          }

          // Track failed requests
          if (finalConfig.sampleFailedRequests && parseInt(status) >= 400) {
            failedRequests.push({ url, method, status: parseInt(status), time: timestamp });
          }
        }

        // Process scenario metrics
        if (
          finalConfig.includeScenarios &&
          metric.metric === 'iteration_duration' &&
          metric.data.tags?.scenario
        ) {
          const scenarioName = metric.data.tags.scenario;
          let scenario = scenarioMetrics.get(scenarioName);

          if (!scenario) {
            scenario = {
              name: scenarioName,
              iterations: 0,
              duration: 0,
              vus: [],
            };
            scenarioMetrics.set(scenarioName, scenario);
          }

          scenario.iterations++;
          scenario.duration += metric.data.value;

          if (!scenario.firstIterationTime) {
            scenario.firstIterationTime = timestamp;
          }
          scenario.lastIterationTime = timestamp;
        }

        // Process check metrics
        if (finalConfig.includeChecks && metric.metric === 'checks' && metric.data.tags?.check) {
          const checkName = metric.data.tags.check;
          let check = checkMetrics.get(checkName);

          if (!check) {
            check = {
              name: checkName,
              passes: 0,
              fails: 0,
            };
            checkMetrics.set(checkName, check);
          }

          // K6 check metric: 1 = pass, 0 = fail
          if (metric.data.value === 1) {
            check.passes++;
          } else {
            check.fails++;
          }
        }
      } catch (parseError) {
        logger.debug(`Failed to parse line ${lineCount}: ${parseError}`);
        // Continue processing other lines
      }
    }

    logger.log(`Parsed ${lineCount} lines from K6 JSON output`);
    logger.log(`Found ${endpointMetrics.size} unique endpoints`);
    logger.log(`Found ${scenarioMetrics.size} scenarios`);
    logger.log(`Found ${checkMetrics.size} checks`);

    // Calculate percentiles for each endpoint
    for (const endpoint of endpointMetrics.values()) {
      endpoint.durations.sort((a, b) => a - b);
      endpoint.p95Duration = calculatePercentile(endpoint.durations, 95);
      endpoint.p99Duration = calculatePercentile(endpoint.durations, 99);
    }

    // Sort slow requests
    if (finalConfig.sampleSlowRequests > 0) {
      slowRequests.sort((a, b) => b.duration - a.duration);
    }

    // Create OpenTelemetry spans
    const tracer = trace.getTracer('k6-json-parser');
    let spanCount = 0;

    // Create parent context
    const parentContext = parentSpan
      ? trace.setSpan(context.active(), parentSpan)
      : context.active();

    // Use test start time or fallback to first metric time
    const testStart = testStartTime || minTime || Date.now();
    const testEnd = maxTime || Date.now();

    // Create spans for each aggregated endpoint
    if (finalConfig.aggregateByEndpoint) {
      for (const [key, endpoint] of endpointMetrics.entries()) {
        try {
          const spanName = `K6 HTTP ${endpoint.method} ${endpoint.url}`;
          const avgDuration = endpoint.totalDuration / endpoint.requestCount;

          const spanStartTime = endpoint.firstRequestTime || testStart;
          const spanEndTime = endpoint.lastRequestTime || testEnd;

          const span = tracer.startSpan(
            spanName,
            {
              startTime: spanStartTime,
              attributes: {
                // OpenTelemetry semantic conventions
                'http.method': endpoint.method,
                'http.url': endpoint.url,
                'span.kind': 'client',
                'component': 'k6',
                'k6.test_type': 'load',

                // Aggregated metrics
                'http.request_count': endpoint.requestCount,
                'http.duration.avg': avgDuration,
                'http.duration.min': endpoint.minDuration,
                'http.duration.max': endpoint.maxDuration,
                'http.duration.p95': endpoint.p95Duration || 0,
                'http.duration.p99': endpoint.p99Duration || 0,

                // Status code distribution
                ...Object.entries(endpoint.statusCodes).reduce(
                  (acc, [status, count]) => {
                    acc[`http.status.${status}.count`] = count;
                    return acc;
                  },
                  {} as Record<string, number>,
                ),

                // Error metrics
                'http.error_count': endpoint.errorCount,
                'http.error_rate': endpoint.errorCount / endpoint.requestCount,
              },
            },
            parentContext,
          );

          // Set span status based on error rate
          if (endpoint.errorCount / endpoint.requestCount > 0.1) {
            // >10% error rate
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `High error rate: ${((endpoint.errorCount / endpoint.requestCount) * 100).toFixed(1)}%`,
            });
          } else if (endpoint.errorCount > 0) {
            span.setStatus({
              code: SpanStatusCode.OK,
              message: `${endpoint.errorCount} errors out of ${endpoint.requestCount} requests`,
            });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }

          span.end(spanEndTime);
          spanCount++;
        } catch (error) {
          logger.error('Failed to create endpoint span', { error, endpoint: key });
        }
      }
    }

    // Create spans for scenarios
    if (finalConfig.includeScenarios) {
      for (const [name, scenario] of scenarioMetrics.entries()) {
        try {
          const spanName = `K6 Scenario: ${name}`;
          const avgIterationDuration = scenario.duration / scenario.iterations;

          const spanStartTime = scenario.firstIterationTime || testStart;
          const spanEndTime = scenario.lastIterationTime || testEnd;

          const span = tracer.startSpan(
            spanName,
            {
              startTime: spanStartTime,
              attributes: {
                'span.kind': 'internal',
                'component': 'k6',
                'k6.scenario.name': name,
                'k6.scenario.iterations': scenario.iterations,
                'k6.scenario.duration.avg': avgIterationDuration,
                'k6.scenario.duration.total': scenario.duration,
              },
            },
            parentContext,
          );

          span.setStatus({ code: SpanStatusCode.OK });
          span.end(spanEndTime);
          spanCount++;
        } catch (error) {
          logger.error('Failed to create scenario span', { error, scenario: name });
        }
      }
    }

    // Create spans for checks
    if (finalConfig.includeChecks) {
      for (const [name, check] of checkMetrics.entries()) {
        try {
          const spanName = `K6 Check: ${name}`;
          const totalChecks = check.passes + check.fails;
          const passRate = check.passes / totalChecks;

          const span = tracer.startSpan(
            spanName,
            {
              startTime: testStart,
              attributes: {
                'span.kind': 'internal',
                'component': 'k6',
                'k6.check.name': name,
                'k6.check.passes': check.passes,
                'k6.check.fails': check.fails,
                'k6.check.total': totalChecks,
                'k6.check.pass_rate': passRate,
              },
            },
            parentContext,
          );

          // Set span status based on pass rate
          if (check.fails > 0) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `${check.fails} check failures out of ${totalChecks}`,
            });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }

          span.end(testEnd);
          spanCount++;
        } catch (error) {
          logger.error('Failed to create check span', { error, check: name });
        }
      }
    }

    // Create spans for sampled slow requests
    if (finalConfig.sampleSlowRequests > 0 && slowRequests.length > 0) {
      const topSlow = slowRequests.slice(0, finalConfig.sampleSlowRequests);
      logger.log(`Creating ${topSlow.length} spans for slowest requests`);

      for (const req of topSlow) {
        try {
          const spanName = `K6 Slow Request: ${req.method} ${normalizeUrl(req.url)}`;

          const span = tracer.startSpan(
            spanName,
            {
              startTime: req.time,
              attributes: {
                'http.method': req.method,
                'http.url': req.url,
                'http.duration': req.duration,
                'span.kind': 'client',
                'component': 'k6',
                'k6.sample_type': 'slow',
              },
            },
            parentContext,
          );

          span.setStatus({ code: SpanStatusCode.OK });
          span.end(req.time + req.duration);
          spanCount++;
        } catch (error) {
          logger.error('Failed to create slow request span', { error });
        }
      }
    }

    // Create spans for sampled failed requests
    if (finalConfig.sampleFailedRequests && failedRequests.length > 0) {
      logger.log(`Creating ${failedRequests.length} spans for failed requests`);

      for (const req of failedRequests) {
        try {
          const spanName = `K6 Failed Request: ${req.method} ${normalizeUrl(req.url)}`;

          const span = tracer.startSpan(
            spanName,
            {
              startTime: req.time,
              attributes: {
                'http.method': req.method,
                'http.url': req.url,
                'http.status_code': req.status,
                'span.kind': 'client',
                'component': 'k6',
                'k6.sample_type': 'failed',
              },
            },
            parentContext,
          );

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${req.status}`,
          });
          span.end(req.time + 100); // Assume 100ms duration for failed requests
          spanCount++;
        } catch (error) {
          logger.error('Failed to create failed request span', { error });
        }
      }
    }

    logger.log(`✅ Created ${spanCount} spans from K6 JSON output`);

    return spanCount;
  } catch (error) {
    logger.error('Failed to parse K6 JSON output', { error, jsonOutputPath });
    return 0;
  }
}
