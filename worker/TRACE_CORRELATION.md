# SuperCheck End-to-End Trace Correlation

## Overview

SuperCheck now implements complete end-to-end trace correlation across all components:
- **Worker processes** create root spans for test/job executions
- **Playwright tests** automatically propagate trace context to tested applications
- **K6 performance tests** inject trace context into HTTP requests
- **Instrumented applications** join the same trace tree automatically
- **All logs** include trace_id and span_id for unified correlation

This enables complete observability from test execution → browser/HTTP requests → application backend → database queries, all viewable in a single unified trace.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ SuperCheck Worker                                            │
│                                                              │
│  ┌────────────────────────────────────┐                     │
│  │ Test Execution Processor           │                     │
│  │ - Creates root span                │                     │
│  │ - Adds sc.* attributes             │                     │
│  │ - Generates TRACEPARENT            │                     │
│  └────────────┬───────────────────────┘                     │
│               │                                              │
│               │ TRACEPARENT env var                          │
│               ▼                                              │
│  ┌────────────────────────────────────┐                     │
│  │ Playwright / K6 Subprocess         │                     │
│  │ - Inherits trace context           │                     │
│  │ - Propagates in HTTP headers       │                     │
│  └────────────┬───────────────────────┘                     │
└───────────────┼──────────────────────────────────────────────┘
                │
                │ HTTP Request with traceparent header
                ▼
┌─────────────────────────────────────────────────────────────┐
│ Instrumented Application                                     │
│                                                              │
│  ┌────────────────────────────────────┐                     │
│  │ OpenTelemetry HTTP Instrumentation │                     │
│  │ - Extracts traceparent header      │                     │
│  │ - Joins existing trace             │                     │
│  └────────────┬───────────────────────┘                     │
│               │                                              │
│               │ Child spans                                  │
│               ▼                                              │
│  ┌────────────────────────────────────┐                     │
│  │ Application Code                    │                     │
│  │ - API endpoint spans               │                     │
│  │ - Database query spans             │                     │
│  │ - Business logic spans             │                     │
│  └────────────┬───────────────────────┘                     │
└───────────────┼──────────────────────────────────────────────┘
                │
                │ OTLP export
                ▼
┌─────────────────────────────────────────────────────────────┐
│ OpenTelemetry Collector                                      │
│ - Receives spans from all sources                           │
│ - Batches and processes                                     │
│ - Exports to ClickHouse                                     │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ ClickHouse Database                                          │
│ - signoz_traces: Unified trace data                         │
│ - signoz_logs: Correlated logs with trace_id/span_id       │
│ - Query by trace_id to see complete execution               │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. Trace Context Generation (Worker)

**Location**: `worker/src/observability/trace-helpers.ts`

New functions added:
- `getTraceparent()` - Generates W3C Trace Context header from active span
- `getTraceContextEnv()` - Returns environment variables for subprocess injection

**Format**: W3C Trace Context
```
traceparent: 00-{trace_id}-{span_id}-{trace_flags}
Example: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

### 2. TRACEPARENT Injection (Subprocesses)

#### Playwright Execution
**Location**: `worker/src/execution/services/execution.service.ts:1099-1117`

```typescript
// Get trace context for subprocess propagation
const traceContextEnv = getTraceContextEnv();

const envVars = {
  PLAYWRIGHT_TEST_DIR: runDir,
  CI: 'true',
  PLAYWRIGHT_EXECUTION_ID: executionId,
  // ... other vars
  // Inject trace context for end-to-end correlation
  ...traceContextEnv,
};
```

Environment variables injected:
- `TRACEPARENT` - W3C Trace Context header
- `OTEL_TRACE_ID` - Trace ID (for convenience)
- `OTEL_SPAN_ID` - Span ID (for convenience)

#### K6 Execution
**Location**: `worker/src/k6/services/k6-execution.service.ts:305-316`

```typescript
// Get trace context for subprocess propagation
const traceContextEnv = getTraceContextEnv();

const k6EnvOverrides = {
  K6_WEB_DASHBOARD: 'true',
  K6_WEB_DASHBOARD_EXPORT: htmlReportPath,
  // ... other vars
  // Inject trace context for end-to-end correlation
  ...traceContextEnv,
};
```

### 3. Playwright HTTP Header Propagation

**Location**: `worker/playwright.config.js:104-115`

```javascript
use: {
  // ... other config
  extraHTTPHeaders: {
    // Propagate W3C Trace Context to enable full trace correlation
    ...(process.env.TRACEPARENT
      ? { traceparent: process.env.TRACEPARENT }
      : {}),
    // Also propagate tracestate if present
    ...(process.env.TRACESTATE
      ? { tracestate: process.env.TRACESTATE }
      : {}),
  },
}
```

**How it works**:
1. Worker spawns Playwright with TRACEPARENT env var
2. Playwright config reads process.env.TRACEPARENT
3. All HTTP requests automatically include `traceparent` header
4. Instrumented apps extract header and join the trace

### 4. K6 Trace Context Propagation

**Location**: `worker/src/k6/services/k6-execution.service.ts:879-997`

K6 scripts are automatically wrapped to provide trace context:

```javascript
// SuperCheck injects this automatically:
const TRACEPARENT = __ENV.TRACEPARENT || '';

// Users can access it in their scripts:
http.get('https://example.com', {
  headers: {
    'traceparent': TRACEPARENT
  }
});
```

**Auto-wrapping logic**:
- Scripts with ES6 exports → Full wrapper with automatic injection
- Simple scripts → Comment header with usage instructions
- Scripts already handling TRACEPARENT → No modification

### 5. Log Correlation

**Location**: `worker/src/observability/log-helpers.ts:40-44`

All logs automatically include trace context:

```typescript
export function emitTelemetryLog({ message, severity, ctx, attributes, error }) {
  const logAttributes = {};

  // Automatically include trace context for log correlation
  const traceId = getCurrentTraceId();
  const spanId = getCurrentSpanId();
  if (traceId) logAttributes['trace_id'] = traceId;
  if (spanId) logAttributes['span_id'] = spanId;

  // ... add SuperCheck context and other attributes
}
```

**Log attributes included**:
- `trace_id` - Links log to trace
- `span_id` - Links log to specific span
- `sc.run_id` - SuperCheck run ID
- `sc.test_id` - Test ID
- `sc.job_id` - Job ID (if applicable)
- `sc.project_id` - Project ID
- `sc.organization_id` - Organization ID
- `sc.run_type` - Execution type (test, job, monitor, k6)

### 6. K6 Console Log Correlation

**Location**: `worker/src/k6/services/k6-execution.service.ts:764-815`

K6 console output is captured and emitted as structured OTLP logs:

```typescript
childProcess.stdout.on('data', (data: Buffer) => {
  const chunk = data.toString();

  // ... publish to Redis for SSE

  // Emit as structured OTLP logs with trace correlation
  const lines = chunk.split('\n').filter(line => line.trim());
  for (const line of lines) {
    const severity = this.parseK6LogSeverity(line);

    emitTelemetryLog({
      message: line,
      severity,
      attributes: {
        'k6.run_id': runId,
        'k6.source': 'stdout',
        'k6.location': location || 'default',
      },
    });
  }
});
```

**Benefits**:
- K6 logs appear in the same trace view as worker spans
- Log severity is automatically detected (ERROR, WARN, INFO, DEBUG)
- Logs include trace_id and span_id automatically
- Real-time correlation between K6 metrics and application behavior

## Attribute Schema

All spans and logs include consistent SuperCheck attributes:

### Core Attributes (sc.*)
- `sc.org_id` / `sc.organization_id` - Organization identifier
- `sc.project_id` - Project identifier
- `sc.run_id` - Execution run identifier
- `sc.run_type` - Execution type: `test`, `job`, `monitor`, `k6`, `playground`
- `sc.test_id` - Test definition ID
- `sc.test_name` - Human-readable test name
- `sc.job_id` - Job definition ID (for job runs)
- `sc.monitor_id` - Monitor ID (for synthetic monitoring)
- `sc.worker_id` - Worker instance identifier
- `sc.region` - Execution region/location
- `sc.artifacts_url` - URL to test artifacts (reports, screenshots)

### Component-Specific Attributes

#### Playwright
- `playwright.run_dir` - Test execution directory
- `playwright.execution_id` - Unique execution ID
- `playwright.is_monitor_execution` - Boolean flag
- `playwright.test_id` - Test identifier
- `playwright.execution_ms` - Execution duration
- `playwright.success` - Boolean success flag

#### K6
- `k6.run_id` - K6 execution run ID
- `k6.location` - Execution location
- `k6.is_job_run` - Boolean flag
- `k6.success` - Boolean success flag
- `k6.timed_out` - Boolean timeout flag
- `k6.source` - Log source: `stdout` or `stderr`

### Standard OpenTelemetry Attributes
- `service.name` - Service identifier (e.g., `supercheck-worker`)
- `service.version` - Service version
- `deployment.environment` - Environment (production, staging, dev)

## Instrumented Application Setup

For complete end-to-end tracing, the tested application should be instrumented with OpenTelemetry:

### Node.js Example

```javascript
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');

const sdk = new NodeSDK({
  serviceName: 'my-app',
  traceExporter: new OTLPTraceExporter({
    url: 'http://otel-collector:4318/v1/traces',
  }),
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
  ],
});

sdk.start();
```

### Python Example

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.flask import FlaskInstrumentor

# Configure OpenTelemetry
trace.set_tracer_provider(TracerProvider())
trace.get_tracer_provider().add_span_processor(
    BatchSpanProcessor(
        OTLPSpanExporter(endpoint="http://otel-collector:4318/v1/traces")
    )
)

# Auto-instrument Flask
app = Flask(__name__)
FlaskInstrumentor().instrument_app(app)
```

### What Happens Automatically

1. **SuperCheck test runs** → Creates root span with TRACEPARENT
2. **Playwright/K6** → Sends HTTP request with `traceparent` header
3. **Application HTTP instrumentation** → Extracts `traceparent` header
4. **Application creates child spans** → Linked to SuperCheck trace
5. **All spans exported** → OpenTelemetry Collector → ClickHouse
6. **Query by trace_id** → See complete execution flow

## Querying Traces

### ClickHouse Queries

**Find traces for a specific run**:
```sql
SELECT
  timestamp,
  serviceName,
  name,
  durationNano / 1000000 as duration_ms,
  attributes['sc.run_id'] as run_id,
  attributes['sc.test_id'] as test_id,
  attributes['http.method'] as method,
  attributes['http.url'] as url
FROM signoz_traces.distributed_signoz_index_v2
WHERE attributes['sc.run_id'] = '01JCABCD...'
ORDER BY timestamp ASC;
```

**Find logs for a trace**:
```sql
SELECT
  timestamp,
  body as message,
  severityText,
  attributes['trace_id'] as trace_id,
  attributes['span_id'] as span_id,
  attributes['sc.run_id'] as run_id
FROM signoz_logs.distributed_logs
WHERE attributes['trace_id'] = '4bf92f3577b34da6a3ce929d0e0e4736'
ORDER BY timestamp ASC;
```

**Complete trace view** (spans + logs):
```sql
WITH trace_spans AS (
  SELECT
    timestamp,
    'span' as type,
    name as message,
    serviceName,
    spanID,
    traceID
  FROM signoz_traces.distributed_signoz_index_v2
  WHERE traceID = '4bf92f3577b34da6a3ce929d0e0e4736'
),
trace_logs AS (
  SELECT
    timestamp,
    'log' as type,
    body as message,
    attributes['service.name'] as serviceName,
    attributes['span_id'] as spanID,
    attributes['trace_id'] as traceID
  FROM signoz_logs.distributed_logs
  WHERE attributes['trace_id'] = '4bf92f3577b34da6a3ce929d0e0e4736'
)
SELECT * FROM trace_spans
UNION ALL
SELECT * FROM trace_logs
ORDER BY timestamp ASC;
```

## Validation Checklist

✅ **Worker Trace Context**
- Worker creates root span for each test/job execution
- Root span includes all `sc.*` attributes
- TRACEPARENT environment variable is generated

✅ **Playwright Integration**
- Playwright subprocess receives TRACEPARENT env var
- playwright.config.js propagates it via extraHTTPHeaders
- All HTTP requests include `traceparent` header

✅ **K6 Integration**
- K6 subprocess receives TRACEPARENT env var
- K6 scripts have access to `__ENV.TRACEPARENT`
- Scripts include instructions for header propagation

✅ **Log Correlation**
- All worker logs include trace_id and span_id
- K6 console output emitted as OTLP logs with correlation
- Logs include consistent `sc.*` attributes

✅ **Instrumented App Integration**
- HTTP instrumentation extracts `traceparent` header
- Application spans join SuperCheck trace
- Database and downstream calls are children of app spans

✅ **End-to-End Verification**
1. Run a Playwright test against an instrumented app
2. Query ClickHouse for the trace_id
3. Verify spans from worker, Playwright, and app appear together
4. Verify logs are correlated with trace_id

## Troubleshooting

### TRACEPARENT not propagating

**Check worker logs**:
```bash
# Look for trace context in execution logs
grep -i traceparent worker.log
```

**Verify subprocess environment**:
```javascript
// In Playwright test
test('verify trace context', () => {
  console.log('TRACEPARENT:', process.env.TRACEPARENT);
  console.log('OTEL_TRACE_ID:', process.env.OTEL_TRACE_ID);
});
```

**Check HTTP headers**:
```javascript
// In application
app.use((req, res, next) => {
  console.log('traceparent header:', req.headers.traceparent);
  next();
});
```

### Spans not correlating

1. **Verify trace_id matches**: Check worker logs and app logs for same trace_id
2. **Check OTEL Collector**: Ensure it's receiving spans from all sources
3. **Verify ClickHouse writes**: Check that spans are being written to both tables
4. **Check clock sync**: Ensure all containers have synchronized clocks

### Logs missing trace context

1. **Use `emitTelemetryLog`**: Ensure custom logs use the helper function
2. **Check active span**: Verify span is active when logging
3. **Check OTEL SDK**: Ensure OpenTelemetry SDK is properly initialized

## Performance Considerations

### Sampling
- Default sampling rate: 100% (capture all traces)
- Configure via `OTEL_TRACE_SAMPLE_RATE` environment variable
- For high-volume production: Consider 10% (0.1) sampling

### Batching
- Spans batched before export: Max 2048 spans, 512 per batch, 5s timeout
- Logs batched: Max 1024 logs, 256 per batch, 2s timeout
- Reduces network overhead and OTEL Collector load

### Storage
- ClickHouse retention configurable per table
- Traces: 7 days default (configurable)
- Logs: 7 days default (configurable)
- Consider archiving old traces to S3 for long-term storage

## Security Considerations

### Sensitive Data
- Trace IDs and span IDs are not sensitive (random UUIDs)
- HTTP headers are captured but can be filtered
- Request/response bodies are NOT captured by default
- Configure scrubbing rules in OTEL Collector for sensitive attributes

### Access Control
- ClickHouse authentication required in production
- API endpoints should validate organization/project access
- Trace IDs should not be exposed in public URLs

## References

- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry JavaScript SDK](https://opentelemetry.io/docs/instrumentation/js/)
- [Playwright Configuration](https://playwright.dev/docs/test-configuration)
- [K6 Environment Variables](https://k6.io/docs/using-k6/environment-variables/)
- [ClickHouse Documentation](https://clickhouse.com/docs/)
