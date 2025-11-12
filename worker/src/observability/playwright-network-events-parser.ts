import { trace, context, SpanStatusCode, type Span } from '@opentelemetry/api';
import * as fs from 'fs';
import * as readline from 'readline';
import { Logger } from '../utils/logger';

const logger = new Logger('PlaywrightNetworkEventsParser');

/**
 * Network event structure (written by playwright-fixtures.js)
 */
interface NetworkEvent {
  type: 'http_request' | 'http_request_failed';
  testId: string;
  testTitle: string;
  testFile: string;
  url: string;
  normalizedUrl: string;
  method: string;
  status?: number;
  resourceType: string;
  startTime: number;
  endTime: number;
  duration: number;
  timing?: {
    dns?: number;
    tcp?: number;
    tls?: number;
    ttfb?: number;
    download?: number;
  };
  errorText?: string;
}

/**
 * Configuration for network events parsing
 */
interface NetworkEventsParserConfig {
  /** Sample rate for successful requests (1.0 = 100%, 0.1 = 10%) */
  sampleRate?: number;
  /** Maximum URL length for span names */
  maxUrlLength?: number;
}

/**
 * Truncate URL to prevent high cardinality
 */
function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) {
    return url;
  }

  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    if (pathname.length > maxLength - urlObj.origin.length) {
      return `${urlObj.origin}${pathname.substring(0, maxLength - urlObj.origin.length - 3)}...`;
    }

    return url.substring(0, maxLength - 3) + '...';
  } catch {
    return url.substring(0, maxLength - 3) + '...';
  }
}

/**
 * Apply sampling decision
 */
function shouldSampleRequest(sampleRate: number, status?: number): boolean {
  // Always sample errors
  if (status && status >= 400) {
    return true;
  }

  // Apply sample rate for successful requests
  return Math.random() < sampleRate;
}

/**
 * Parse network events file and create OpenTelemetry spans
 *
 * @param eventsFilePath - Path to the network events NDJSON file
 * @param telemetryCtx - Telemetry context with trace/span IDs for correlation
 * @param parentSpan - Parent span for proper trace hierarchy
 * @param config - Configuration options for parsing
 * @returns Number of spans created
 */
export async function createSpansFromNetworkEvents(
  eventsFilePath: string,
  telemetryCtx?: { traceId?: string; spanId?: string },
  parentSpan?: Span,
  config: NetworkEventsParserConfig = {},
): Promise<number> {
  const finalConfig: Required<NetworkEventsParserConfig> = {
    sampleRate: config.sampleRate ?? 1.0,
    maxUrlLength: config.maxUrlLength ?? 200,
  };

  try {
    // Check if events file exists
    if (!fs.existsSync(eventsFilePath)) {
      logger.warn(`Network events file not found: ${eventsFilePath}`);
      return 0;
    }

    logger.log(`Parsing Playwright network events: ${eventsFilePath}`);

    const tracer = trace.getTracer('playwright-network-events-parser');
    let spanCount = 0;
    let sampledOutCount = 0;
    let lineCount = 0;

    // Create parent context
    const parentContext = parentSpan
      ? trace.setSpan(context.active(), parentSpan)
      : context.active();

    // Parse NDJSON file line by line
    const fileStream = fs.createReadStream(eventsFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      lineCount++;

      if (!line.trim()) {
        continue;
      }

      try {
        const event: NetworkEvent = JSON.parse(line);

        // Apply sampling
        if (!shouldSampleRequest(finalConfig.sampleRate, event.status)) {
          sampledOutCount++;
          continue;
        }

        // Create span name
        const spanName = `HTTP ${event.method} ${truncateUrl(event.normalizedUrl, finalConfig.maxUrlLength)}`;

        // Create span
        const span = tracer.startSpan(
          spanName,
          {
            startTime: event.startTime,
            attributes: {
              // OpenTelemetry semantic conventions
              'http.method': event.method,
              'http.url': event.url,
              'http.target': new URL(event.url).pathname,
              'http.scheme': new URL(event.url).protocol.replace(':', ''),
              'http.host': new URL(event.url).host,
              'span.kind': 'client',
              'component': 'playwright',

              // Playwright specific
              'playwright.resource_type': event.resourceType,
              'playwright.test_id': event.testId,
              'playwright.test_title': event.testTitle,

              // Duration
              'http.duration_ms': event.duration,

              // Add status if available
              ...(event.status && { 'http.status_code': event.status }),
            },
          },
          parentContext,
        );

        // Add timing breakdown if available
        if (event.timing) {
          if (event.timing.dns !== undefined) {
            span.setAttribute('http.timing.dns', event.timing.dns);
          }
          if (event.timing.tcp !== undefined) {
            span.setAttribute('http.timing.tcp', event.timing.tcp);
          }
          if (event.timing.tls !== undefined) {
            span.setAttribute('http.timing.tls', event.timing.tls);
          }
          if (event.timing.ttfb !== undefined) {
            span.setAttribute('http.timing.ttfb', event.timing.ttfb);
          }
          if (event.timing.download !== undefined) {
            span.setAttribute('http.timing.download', event.timing.download);
          }
        }

        // Set span status
        if (event.type === 'http_request_failed') {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: event.errorText || 'Request failed',
          });
          span.setAttribute('http.error', event.errorText || 'Unknown error');
        } else if (event.status && event.status >= 400) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${event.status}`,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        // End span
        span.end(event.endTime);
        spanCount++;
      } catch (parseError) {
        logger.debug(`Failed to parse line ${lineCount}: ${parseError}`);
        // Continue processing other lines
      }
    }

    logger.log(
      `✅ Created ${spanCount} network request spans from ${lineCount} events (sampled out: ${sampledOutCount})`,
    );

    return spanCount;
  } catch (error) {
    logger.error('Failed to parse network events file', { error, eventsFilePath });
    return 0;
  }
}

/**
 * Get summary of network events without creating spans
 */
export async function getNetworkEventsSummary(
  eventsFilePath: string,
): Promise<{
  totalEvents: number;
  requestsByMethod: Record<string, number>;
  requestsByStatus: Record<string, number>;
  totalDuration: number;
  averageDuration: number;
  failedRequests: number;
}> {
  const summary = {
    totalEvents: 0,
    requestsByMethod: {} as Record<string, number>,
    requestsByStatus: {} as Record<string, number>,
    totalDuration: 0,
    averageDuration: 0,
    failedRequests: 0,
  };

  try {
    const fileStream = fs.createReadStream(eventsFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const event: NetworkEvent = JSON.parse(line);
        summary.totalEvents++;

        summary.requestsByMethod[event.method] =
          (summary.requestsByMethod[event.method] || 0) + 1;

        if (event.status) {
          const status = event.status.toString();
          summary.requestsByStatus[status] =
            (summary.requestsByStatus[status] || 0) + 1;
        }

        summary.totalDuration += event.duration;

        if (event.type === 'http_request_failed' || (event.status && event.status >= 400)) {
          summary.failedRequests++;
        }
      } catch {
        // Skip invalid lines
      }
    }

    summary.averageDuration =
      summary.totalEvents > 0 ? summary.totalDuration / summary.totalEvents : 0;

    return summary;
  } catch (error) {
    logger.error('Failed to get network events summary', { error, eventsFilePath });
    throw error;
  }
}
