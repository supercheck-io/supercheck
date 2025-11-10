/**
 * OpenTelemetry Instrumentation for Supercheck Worker
 *
 * This module provides automatic distributed tracing for Playwright tests and worker operations.
 * Traces are sent to the OTel Collector and stored in ClickHouse for analysis.
 *
 * Features:
 * - Auto-instrumentation of HTTP, Playwright, database operations
 * - Custom resource attributes for Supercheck correlation (run_id, test_id, job_id)
 * - Configurable via environment variables
 * - Graceful shutdown handling
 * - Error resilience (fails silently if observability is disabled)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter as OTLPGrpcExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as OTLPHttpTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter as OTLPGrpcLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { OTLPLogExporter as OTLPHttpLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { logs } from '@opentelemetry/api-logs';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { existsSync } from 'fs';
import { createExecutionLogProcessor } from './execution-log-processor';
import { createExecutionSpanProcessor } from './execution-span-processor';

/**
 * Configuration interface for observability
 */
interface ObservabilityConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  otlpEndpoint: string;
  otlpHttpEndpoint: string;
  otlpHttpLogsEndpoint: string;
  otlpProtocol: 'grpc' | 'http';
  logLevel: DiagLogLevel;
  sampleRate: number;
  isRunningInDocker: boolean;
}

/**
 * Detect if the process is running inside Docker
 * Checks for /.dockerenv file (most reliable method)
 */
function isRunningInDocker(): boolean {
  try {
    return existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/**
 * Resolve the OTEL collector host based on environment
 */
function resolveOtelHost(): string {
  // If explicitly set, use it
  if (process.env.OTEL_COLLECTOR_HOST) {
    return process.env.OTEL_COLLECTOR_HOST;
  }

  // Auto-detect based on Docker presence
  if (isRunningInDocker()) {
    return 'otel-collector';
  }

  return 'localhost';
}

/**
 * Load and validate observability configuration from environment variables
 * Uses sensible defaults for all values with auto-detection for local vs Docker
 */
function loadObservabilityConfig(): ObservabilityConfig {
  const isDocker = isRunningInDocker();
  const otelHost = resolveOtelHost();

  const otlpHttpEndpoint =
    process.env.OTEL_EXPORTER_OTLP_HTTP_ENDPOINT ||
    `http://${otelHost}:4318/v1/traces`;

  // Derive logs endpoint from traces endpoint by replacing /v1/traces with /v1/logs
  const otlpHttpLogsEndpoint =
    process.env.OTEL_EXPORTER_OTLP_HTTP_LOGS_ENDPOINT ||
    otlpHttpEndpoint.replace('/v1/traces', '/v1/logs');

  return {
    // Master switch - can disable all observability with single env var
    enabled: process.env.ENABLE_WORKER_OBSERVABILITY !== 'false',

    // Service identification
    serviceName: process.env.OTEL_SERVICE_NAME || 'supercheck',
    serviceVersion: process.env.SERVICE_VERSION || process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'production',

    // OTel Collector endpoint (gRPC) - auto-detects Docker vs local
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || `http://${otelHost}:4317`,
    otlpHttpEndpoint,
    otlpHttpLogsEndpoint,
    otlpProtocol: (process.env.OTEL_EXPORTER_OTLP_PROTOCOL || 'grpc')
      .toLowerCase()
      .startsWith('http')
      ? 'http'
      : 'grpc',

    // Logging level for OpenTelemetry SDK (errors only by default)
    logLevel: process.env.OTEL_LOG_LEVEL === 'debug'
      ? DiagLogLevel.DEBUG
      : DiagLogLevel.ERROR,

    // Sampling rate (1.0 = 100%, 0.5 = 50%)
    sampleRate: parseFloat(process.env.OTEL_TRACE_SAMPLE_RATE || '1.0'),

    // Environment detection
    isRunningInDocker: isDocker,
  };
}

/**
 * Create resource attributes for trace correlation
 * These attributes appear on all spans and enable filtering by Supercheck entities
 */
function createResourceAttributes(config: ObservabilityConfig): Record<string, string> {
  const attributes: Record<string, string> = {
    // Standard semantic conventions
    [SEMRESATTRS_SERVICE_NAME]: config.serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: config.serviceVersion,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.environment,

    // Supercheck-specific attributes (empty by default, set at runtime)
    'sc.service.type': 'worker',
    'sc.component': 'test-executor',
  };

  // Add optional custom attributes from environment
  if (process.env.OTEL_RESOURCE_ATTRIBUTES) {
    const customAttrs = process.env.OTEL_RESOURCE_ATTRIBUTES.split(',');
    customAttrs.forEach((attr) => {
      const [key, value] = attr.split('=');
      if (key && value) {
        attributes[key.trim()] = value.trim();
      }
    });
  }

  return attributes;
}

/**
 * Configure auto-instrumentations with optimized settings
 * Disables unnecessary instrumentations and configures useful ones
 */
function configureInstrumentations() {
  return getNodeAutoInstrumentations({
    // Disable file system instrumentation (too noisy)
    '@opentelemetry/instrumentation-fs': {
      enabled: false,
    },

    // Enable HTTP instrumentation with custom hooks
    '@opentelemetry/instrumentation-http': {
      enabled: true,
      requestHook: (span, request) => {
        // Add useful HTTP attributes
        // Type guard for IncomingMessage (has headers property)
        if ('headers' in request && request.headers) {
          const userAgent = request.headers['user-agent'];
          if (userAgent) {
            span.setAttribute('http.user_agent', Array.isArray(userAgent) ? userAgent[0] : userAgent);
          }

          // Capture Supercheck context from headers (if present)
          const runId = request.headers['x-supercheck-run-id'];
          if (runId) {
            span.setAttribute('sc.run_id', Array.isArray(runId) ? runId[0] : runId);
          }

          const testId = request.headers['x-supercheck-test-id'];
          if (testId) {
            span.setAttribute('sc.test_id', Array.isArray(testId) ? testId[0] : testId);
          }
        }
      },
      responseHook: (span, response) => {
        // Capture response size if available
        // Type guard for IncomingMessage (has headers property)
        if ('headers' in response && response.headers) {
          const contentLength = response.headers['content-length'];
          if (contentLength) {
            const length = Array.isArray(contentLength) ? contentLength[0] : contentLength;
            span.setAttribute('http.response.body.size', parseInt(length, 10));
          }
        }
      },
      ignoreIncomingRequestHook: (request) => {
        // Ignore health check endpoints to reduce noise
        const url = request.url || '';
        return url.includes('/health') || url.includes('/metrics');
      },
    },

    // Enable Express instrumentation (NestJS uses Express under the hood)
    '@opentelemetry/instrumentation-express': {
      enabled: true,
    },

    // Enable database instrumentations
    '@opentelemetry/instrumentation-pg': {
      enabled: true,
      enhancedDatabaseReporting: true, // Capture SQL queries
    },

    '@opentelemetry/instrumentation-redis-4': {
      enabled: true,
    },

    // Enable AWS SDK instrumentation (for S3 operations)
    '@opentelemetry/instrumentation-aws-sdk': {
      enabled: true,
      suppressInternalInstrumentation: true,
    },

    // Disable DNS instrumentation (too granular)
    '@opentelemetry/instrumentation-dns': {
      enabled: false,
    },

    // Disable net instrumentation (covered by HTTP)
    '@opentelemetry/instrumentation-net': {
      enabled: false,
    },
  });
}

/**
 * Initialize OpenTelemetry SDK
 * Returns SDK instance or null if initialization fails
 */
function initializeObservability(): NodeSDK | null {
  const config = loadObservabilityConfig();

  // If observability is disabled, return early
  if (!config.enabled) {
    console.log('[Observability] Worker observability is disabled (ENABLE_WORKER_OBSERVABILITY=false)');
    return null;
  }

  try {
    // Set diagnostic logging level
    diag.setLogger(new DiagConsoleLogger(), config.logLevel);

    // Create resource with custom attributes
    const resource = new Resource(createResourceAttributes(config));

    // Create OTLP exporter (HTTP fallback avoids gRPC transport issues)
    const traceExporter =
      config.otlpProtocol === 'http'
        ? new OTLPHttpTraceExporter({
            url: config.otlpHttpEndpoint,
          })
        : new OTLPGrpcExporter({
            url: config.otlpEndpoint,
          });

    // Create batch span processor for efficient export
    const batchSpanProcessor = new BatchSpanProcessor(traceExporter, {
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      scheduledDelayMillis: 5000, // Export every 5 seconds
      exportTimeoutMillis: 30000, // 30s timeout
    });

    // Wrap with execution span filter to only show test/job/monitor spans
    // This removes noise from infrastructure operations (S3, Redis publish, HTTP calls)
    const spanProcessor = createExecutionSpanProcessor(batchSpanProcessor, {
      enableFiltering: process.env.FILTER_EXECUTION_SPANS !== 'false',
      alwaysShowErrors: true,
    });

    // Configure log exporter/provider
    const logExporter =
      config.otlpProtocol === 'http'
        ? new OTLPHttpLogExporter({
            url: config.otlpHttpLogsEndpoint,
          })
        : new OTLPGrpcLogExporter({
            url: config.otlpEndpoint,
          });

    const loggerProvider = new LoggerProvider({ resource });

    // Create batch processor for efficient export
    const batchLogProcessor = new BatchLogRecordProcessor(logExporter, {
      maxQueueSize: 1024,
      maxExportBatchSize: 256,
      scheduledDelayMillis: 2000,
      exportTimeoutMillis: 10000,
    });

    // Wrap with execution log filter to only show test/job/monitor logs
    // This removes noise from infrastructure operations (S3, Redis, DB)
    const filteredLogProcessor = createExecutionLogProcessor(batchLogProcessor, {
      enableFiltering: process.env.FILTER_EXECUTION_LOGS !== 'false',
      alwaysShowErrors: true,
    });

    loggerProvider.addLogRecordProcessor(filteredLogProcessor);
    logs.setGlobalLoggerProvider(loggerProvider);
    registerLoggerProvider(loggerProvider);

    // Initialize SDK with all configurations
    const sdk = new NodeSDK({
      resource,
      spanProcessor,
      instrumentations: configureInstrumentations(),
    });

    // Start the SDK
    sdk.start();

    console.log(`[Observability] Worker observability initialized successfully`);
    console.log(`[Observability] Service: ${config.serviceName} v${config.serviceVersion}`);
    console.log(`[Observability] Environment: ${config.environment}`);
    console.log(`[Observability] Running in: ${config.isRunningInDocker ? 'Docker' : 'Local/Native'}`);
    console.log(`[Observability] OTLP Endpoint: ${config.otlpEndpoint}`);
    if (config.otlpProtocol === 'http') {
      console.log(`[Observability] OTLP HTTP Traces Endpoint: ${config.otlpHttpEndpoint}`);
      console.log(`[Observability] OTLP HTTP Logs Endpoint: ${config.otlpHttpLogsEndpoint}`);
    }
    console.log(`[Observability] Sample Rate: ${(config.sampleRate * 100).toFixed(0)}%`);

    return sdk;
  } catch (error) {
    // Log error but don't crash the application
    console.error('[Observability] Failed to initialize observability:', error);
    return null;
  }
}

// Initialize observability on module load
const telemetryState: {
  sdk: NodeSDK | null;
  loggerProvider: LoggerProvider | null;
} = {
  sdk: null,
  loggerProvider: null,
};

function registerLoggerProvider(provider: LoggerProvider) {
  telemetryState.loggerProvider = provider;
}

telemetryState.sdk = initializeObservability();

/**
 * Graceful shutdown handler
 * Ensures all pending spans are exported before process exits
 */
async function shutdownObservability(): Promise<void> {
  try {
    if (telemetryState.sdk) {
      console.log('[Observability] Shutting down observability SDK...');
      await telemetryState.sdk.shutdown();
      console.log('[Observability] Observability SDK shut down successfully');
    }

    if (telemetryState.loggerProvider) {
      console.log('[Observability] Flushing telemetry logs...');
      await telemetryState.loggerProvider.shutdown();
      console.log('[Observability] Telemetry logs flushed successfully');
    }
  } catch (error) {
    console.error('[Observability] Error shutting down observability SDK:', error);
  }
}

// Register shutdown handlers
process.on('SIGTERM', async () => {
  await shutdownObservability();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await shutdownObservability();
  process.exit(0);
});

// Handle uncaught exceptions gracefully
process.on('beforeExit', async () => {
  await shutdownObservability();
});

const sdkInstance = telemetryState.sdk;
export { sdkInstance as sdk };
export default sdkInstance;
