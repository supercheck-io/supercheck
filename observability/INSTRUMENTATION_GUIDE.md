# OpenTelemetry Instrumentation Guide

Complete guide to instrument your applications to send traces, logs, and metrics to SigNoz.

## 📋 Table of Contents

- [Node.js / TypeScript Applications](#nodejs--typescript-applications)
- [Next.js Applications](#nextjs-applications)
- [NestJS Applications](#nestjs-applications)
- [Testing Your Instrumentation](#testing-your-instrumentation)

---

## Node.js / TypeScript Applications

### 1. Install Dependencies

```bash
npm install --save \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http
```

### 2. Create Instrumentation File

Create `instrumentation.ts` or `tracing.ts`:

```typescript
// instrumentation.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const resource = new Resource({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'my-app',
  [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
  'deployment.environment': process.env.NODE_ENV || 'development',
});

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  }),
  logExporter: new OTLPLogExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/logs',
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/metrics',
    }),
    exportIntervalMillis: 60000, // Export every 60 seconds
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Automatically instrument popular libraries
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-pg': { enabled: true },
      '@opentelemetry/instrumentation-redis-4': { enabled: true },
    }),
  ],
});

sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.error('Error terminating tracing', error))
    .finally(() => process.exit(0));
});

export default sdk;
```

### 3. Load Instrumentation Before Your App

**Option A: Using Node.js --require flag**

```bash
node --require ./instrumentation.js app.js
```

**Option B: Import at the top of your main file**

```typescript
// index.ts or app.ts (MUST be first import)
import './instrumentation';

// Rest of your imports
import express from 'express';
// ...
```

### 4. Environment Variables

Add to your `.env`:

```bash
# OpenTelemetry Configuration
OTEL_SERVICE_NAME=my-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
NODE_ENV=development
```

### 5. Manual Instrumentation (Optional)

For custom spans and attributes:

```typescript
import { trace, context } from '@opentelemetry/api';

const tracer = trace.getTracer('my-app');

async function myFunction() {
  const span = tracer.startSpan('my-operation');

  try {
    // Add custom attributes
    span.setAttribute('user.id', '12345');
    span.setAttribute('operation.type', 'data-processing');

    // Your code here
    const result = await someOperation();

    span.setStatus({ code: 1 }); // Success
    return result;
  } catch (error) {
    span.setStatus({ code: 2, message: error.message }); // Error
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
```

---

## Next.js Applications

### 1. Install Dependencies

```bash
npm install --save \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http
```

### 2. Create `instrumentation.ts` (Next.js 13+ App Router)

Next.js has built-in support for OpenTelemetry instrumentation:

```typescript
// instrumentation.ts (at project root)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = await import('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');

    const sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: 'supercheck-app',
        'deployment.environment': process.env.NODE_ENV || 'development',
      }),
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      }),
    });

    sdk.start();
  }
}
```

### 3. Enable Instrumentation in `next.config.js`

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
```

### 4. Environment Variables

```bash
# .env.local
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
NEXT_PUBLIC_APP_ENV=development
```

### 5. Custom Spans in API Routes

```typescript
// app/api/users/route.ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('supercheck-app');

export async function GET(request: Request) {
  return tracer.startActiveSpan('fetch-users', async (span) => {
    try {
      span.setAttribute('http.route', '/api/users');

      const users = await db.query('SELECT * FROM users');

      span.setStatus({ code: 1 });
      return Response.json(users);
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

---

## NestJS Applications

### 1. Install Dependencies

```bash
npm install --save \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/instrumentation-nestjs-core
```

### 2. Create Tracing Module

```typescript
// src/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';

const sdk = new NodeSDK({
  resource: new Resource({
    'service.name': 'supercheck-worker',
    'service.version': '1.0.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [
    getNodeAutoInstrumentations(),
    new NestInstrumentation(),
  ],
});

export default sdk;
```

### 3. Initialize in `main.ts`

```typescript
// src/main.ts
import './tracing'; // MUST be first import
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

### 4. Custom Spans in Services

```typescript
// src/test-executor/test-executor.service.ts
import { Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

@Injectable()
export class TestExecutorService {
  private readonly tracer = trace.getTracer('supercheck-worker');

  async executeTest(testId: string, runId: string) {
    return this.tracer.startActiveSpan('execute-playwright-test', async (span) => {
      try {
        span.setAttribute('test.id', testId);
        span.setAttribute('run.id', runId);
        span.setAttribute('worker.id', process.env.WORKER_ID || 'unknown');

        // Execute test
        const result = await this.runPlaywrightTest(testId);

        span.setAttribute('test.status', result.status);
        span.setStatus({ code: 1 });

        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: 2, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
```

---

## Testing Your Instrumentation

### 1. Start SigNoz

```bash
cd observability/deploy/docker
docker compose up -d
```

### 2. Run Your Instrumented App

```bash
# Set environment variables
export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Run your app
npm run dev
```

### 3. Generate Traffic

Make some requests to your application:

```bash
curl http://localhost:3000/api/users
curl http://localhost:3000/api/health
```

### 4. Verify Data in ClickHouse

**Check Traces:**
```bash
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT serviceName, name, timestamp FROM signoz_traces.signoz_index_v3 ORDER BY timestamp DESC LIMIT 5 FORMAT Vertical"
```

**Check Logs:**
```bash
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT body, severity_text, timestamp FROM signoz_logs.logs_v2 ORDER BY timestamp DESC LIMIT 5 FORMAT Vertical"
```

**Check Metrics:**
```bash
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT metric_name, COUNT(*) as count FROM signoz_metrics.samples_v4 GROUP BY metric_name"
```

### 5. View in SigNoz UI

Open http://localhost:8080 in your browser:

1. **Traces Tab**: See all your request traces with timing information
2. **Logs Tab**: View application logs correlated with traces
3. **Metrics Tab**: Monitor request rates, latencies, error rates
4. **Service Map**: Visualize service dependencies

---

## SuperCheck-Specific Attributes

For SuperCheck applications, add these custom attributes:

```typescript
import { trace } from '@opentelemetry/api';

const span = trace.getActiveSpan();

// SuperCheck metadata
span.setAttribute('sc.org_id', organizationId);
span.setAttribute('sc.project_id', projectId);
span.setAttribute('sc.run_id', runId);
span.setAttribute('sc.run_type', 'playwright'); // or 'k6', 'monitor', 'job'
span.setAttribute('sc.test_name', testName);
span.setAttribute('sc.worker_id', workerId);

// Playwright-specific
span.setAttribute('playwright.browser', 'chromium');
span.setAttribute('playwright.viewport', '1280x720');
span.setAttribute('playwright.test_file', testFilePath);
```

---

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `OTEL_SERVICE_NAME` | Name of your service | `supercheck-app` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel Collector endpoint | `http://localhost:4318` |
| `NODE_ENV` | Deployment environment | `development` |
| `OTEL_LOG_LEVEL` | Log level for OTel SDK | `info` |

---

## Common Issues

### Traces not appearing

1. Check OTel Collector logs: `docker logs signoz-otel-collector --tail 50`
2. Verify endpoint is reachable: `curl http://localhost:4318`
3. Ensure instrumentation is loaded **before** other imports

### High memory usage

Adjust batch sizes in your instrumentation:

```typescript
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

const sdk = new NodeSDK({
  spanProcessor: new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 100,
    maxExportBatchSize: 10,
    scheduledDelayMillis: 500,
  }),
});
```

### Missing HTTP spans

Enable HTTP instrumentation explicitly:

```typescript
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

instrumentations: [
  new HttpInstrumentation({
    requestHook: (span, request) => {
      span.setAttribute('http.client_ip', request.socket.remoteAddress);
    },
  }),
]
```

---

## Resources

- [OpenTelemetry Node.js Docs](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
- [SigNoz Documentation](https://signoz.io/docs/)
- [Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [Auto-instrumentation Libraries](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/metapackages/auto-instrumentations-node)
