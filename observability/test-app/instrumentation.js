// instrumentation.js - MUST be loaded first
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

console.log('🔧 Initializing OpenTelemetry instrumentation...');

const resource = new Resource({
  [ATTR_SERVICE_NAME]: 'signoz-test-app',
  [ATTR_SERVICE_VERSION]: '1.0.0',
  'deployment.environment': 'development',
  'app.type': 'test-application',
});

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
  logExporter: new OTLPLogExporter({
    url: 'http://localhost:4318/v1/logs',
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: 'http://localhost:4318/v1/metrics',
    }),
    exportIntervalMillis: 10000, // Export every 10 seconds for testing
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
    }),
  ],
});

sdk.start();

console.log('✅ OpenTelemetry SDK started');
console.log('📡 Sending telemetry to http://localhost:4318');

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('✅ Tracing terminated'))
    .catch((error) => console.error('❌ Error terminating tracing', error))
    .finally(() => process.exit(0));
});

export default sdk;
