# Supercheck Observability Guide

**Complete Guide to Distributed Tracing with OpenTelemetry + ClickHouse**

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Local Development Setup](#local-development-setup)
4. [Docker/Production Setup](#dockerproduction-setup)
5. [Testing with External Node.js App](#testing-with-external-nodejs-app)
6. [Viewing Traces in UI](#viewing-traces-in-ui)
7. [Troubleshooting](#troubleshooting)
8. [Environment Variables Reference](#environment-variables-reference)
9. [Advanced Usage](#advanced-usage)

---

## Quick Start

### 1. Start Observability Stack (Docker Compose)

```bash
# Start all services including observability
docker-compose up -d

# Verify observability services are healthy
docker-compose ps | grep -E "clickhouse|otel|schema"
# Expected: clickhouse-observability, otel-collector, schema-migrator (exited 0)
```

### 2. Verify Setup

```bash
# Check ClickHouse
curl http://localhost:8124/ping
# Expected: Ok.

# Check OTel Collector
curl http://localhost:13133/
# Expected: health check response

# Check worker instrumentation (if running in Docker)
docker-compose logs worker | grep Observability
# Expected: "[Observability] Worker observability initialized successfully"
```

### 3. Run a Test & View Traces

1. Open Supercheck: `http://localhost:3000`
2. Create and run a Playwright test
3. Go to **Observability → Traces**
4. Filter by service: `supercheck-worker`
5. See your test traces with `sc.run_id` and `sc.test_id` attributes

**Done!** 🎉 Your Playwright tests are now automatically traced.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Supercheck Platform                     │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  1. Playwright Test (Worker)                            │
│     └─ Auto-instrumented with OpenTelemetry ✨          │
│        └─ Creates trace with sc.run_id, sc.test_id      │
│           └─ Makes HTTP request to YOUR app             │
│               └─ Injects trace context headers          │
│                                                           │
│  2. Your Application (instrumented)                      │
│     └─ Receives trace context                           │
│        └─ Continues the distributed trace               │
│           └─ Adds own spans (DB, API calls)             │
│                                                           │
│  3. Both send traces to:                                 │
│     OTel Collector (port 4317 gRPC, 4318 HTTP)          │
│     └─ Processes & batches traces                       │
│        └─ Exports to ClickHouse                         │
│                                                           │
│  4. ClickHouse Database                                  │
│     └─ Stores traces in signoz_traces DB                │
│                                                           │
│  5. Supercheck UI (/observability)                      │
│     └─ Queries ClickHouse directly                      │
│        └─ Shows distributed traces                      │
│           └─ Filter by run_id, test_id, service         │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**Key Features:**

- ✅ **Automatic Instrumentation**: Playwright tests traced automatically
- ✅ **Distributed Tracing**: See complete journey from test → app → database
- ✅ **Custom Attributes**: Filter by `sc.run_id`, `sc.test_id`, `sc.job_id`
- ✅ **Zero Configuration**: Works out of the box (enabled by default)
- ✅ **Toggle ON/OFF**: Set `ENABLE_WORKER_OBSERVABILITY=false` to disable
- ✅ **Low Overhead**: <1ms per operation, batched exports

---

## Local Development Setup

### Prerequisites

- Docker Desktop running (for ClickHouse + OTel Collector)
- Node.js 20+ installed

### Step 1: Start Observability Services Only

```bash
# Start just the observability stack (not the full app)
docker-compose up -d clickhouse-observability schema-migrator otel-collector

# Wait for services to be ready (~30 seconds)
docker-compose logs -f schema-migrator
# Wait for: "Applied migrations successfully"
```

### Step 2: Configure Local Environment

Your `.env` files should have these settings for **local development**:

**worker/.env:**
```bash
# FOR LOCAL DEV - use localhost
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
ENABLE_WORKER_OBSERVABILITY=true
OTEL_SERVICE_NAME=supercheck-worker
OTEL_LOG_LEVEL=error
CLICKHOUSE_URL=http://localhost:8124
```

**app/.env:**
```bash
# FOR LOCAL DEV - use localhost
CLICKHOUSE_URL=http://localhost:8124
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
ENABLE_WORKER_OBSERVABILITY=true
```

### Step 3: Run Worker Locally

```bash
cd worker
npm install  # Install OpenTelemetry packages
npm run dev
```

**Expected output:**
```
[Observability] Worker observability initialized successfully
[Observability] Service: supercheck-worker v1.0.0
[Observability] OTLP Endpoint: http://localhost:4317
```

✅ **If you see this, instrumentation is working!**

❌ **If you see DNS resolution errors**, check that:
- OTel Collector is running: `docker-compose ps otel-collector`
- Endpoint is set to `localhost:4317` (not `otel-collector:4317`)

### Step 4: Run App Locally

```bash
cd app
npm run dev
```

Open `http://localhost:3000` and navigate to `/observability/traces`.

---

## Docker/Production Setup

### docker-compose.yml Configuration

Observability is already configured in `docker-compose.yml`:

```yaml
# Observability stack services
clickhouse-observability:
  image: clickhouse/clickhouse-server:25.5.6
  ports:
    - "8124:8123"  # HTTP interface
    - "9001:9000"  # Native protocol

schema-migrator:
  image: signoz/signoz-schema-migrator:v0.129.8
  # Runs once to create tables

otel-collector:
  image: signoz/signoz-otel-collector:v0.129.8
  ports:
    - "4317:4317"  # OTLP gRPC
    - "4318:4318"  # OTLP HTTP
```

### Environment Variables (Docker)

For **Docker deployment**, use these in `docker-compose.yml`:

```yaml
x-common-env: &common-env
  # Observability Configuration
  ENABLE_WORKER_OBSERVABILITY: ${ENABLE_WORKER_OBSERVABILITY:-true}
  OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT:-http://otel-collector:4317}
  OTEL_SERVICE_NAME: ${OTEL_SERVICE_NAME:-supercheck}
  OTEL_LOG_LEVEL: ${OTEL_LOG_LEVEL:-error}
  OTEL_TRACE_SAMPLE_RATE: ${OTEL_TRACE_SAMPLE_RATE:-1.0}
  CLICKHOUSE_URL: ${CLICKHOUSE_URL:-http://clickhouse-observability:8123}
  USE_CLICKHOUSE_DIRECT: ${USE_CLICKHOUSE_DIRECT:-true}
```

**Note:** In Docker, use service names (`otel-collector`, `clickhouse-observability`), not `localhost`.

---

## Testing with External Node.js App

Let's test distributed tracing by instrumenting an external Express.js app.

### Step 1: Create Sample App

```bash
mkdir test-observability-app
cd test-observability-app
npm init -y
npm install express
npm install @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-grpc \
  @opentelemetry/resources @opentelemetry/semantic-conventions
```

### Step 2: Create Instrumentation File

**instrumentation.js:**
```javascript
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { Resource } = require('@opentelemetry/resources');
const { SEMRESATTRS_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: 'my-test-app',
    // Add custom Supercheck attributes
    'sc.organization_id': 'org-test-123',
    'sc.project_id': 'proj-test-456',
  }),
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4317', // Supercheck's OTel Collector
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing shut down'))
    .catch((err) => console.error('Error shutting down tracing', err))
    .finally(() => process.exit(0));
});

console.log('✅ OpenTelemetry instrumentation initialized');
```

### Step 3: Create Express App

**app.js:**
```javascript
const express = require('express');
const { trace } = require('@opentelemetry/api');

const app = express();

// Simple endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Hello from test app!', timestamp: new Date() });
});

// Complex endpoint with custom spans
app.get('/api/users/:id', async (req, res) => {
  const tracer = trace.getTracer('my-test-app');

  await tracer.startActiveSpan('fetch-user', async (span) => {
    try {
      span.setAttribute('user.id', req.params.id);

      // Simulate database query
      await tracer.startActiveSpan('db.query', async (dbSpan) => {
        dbSpan.setAttribute('db.system', 'postgresql');
        dbSpan.setAttribute('db.statement', `SELECT * FROM users WHERE id = ${req.params.id}`);

        await new Promise(resolve => setTimeout(resolve, 50)); // Simulate delay

        dbSpan.end();
      });

      span.setStatus({ code: 0 }); // OK
      res.json({ userId: req.params.id, name: `User ${req.params.id}` });
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      res.status(500).json({ error: error.message });
    } finally {
      span.end();
    }
  });
});

app.listen(3001, () => {
  console.log('✅ Test app running on http://localhost:3001');
  console.log('📊 Traces sent to Supercheck at http://localhost:4317');
});
```

### Step 4: Run the App

```bash
node --require ./instrumentation.js app.js
```

**Expected output:**
```
✅ OpenTelemetry instrumentation initialized
✅ Test app running on http://localhost:3001
📊 Traces sent to Supercheck at http://localhost:4317
```

### Step 5: Generate Traces

```bash
# Make some requests
curl http://localhost:3001/
curl http://localhost:3001/api/users/123
curl http://localhost:3001/api/users/456
```

### Step 6: View Traces in Supercheck

1. Open `http://localhost:3000/observability/traces`
2. Filter by service: `my-test-app`
3. You should see traces with:
   - HTTP requests
   - Database query spans
   - Timing information

### Step 7: Test Distributed Tracing

Create a Playwright test in Supercheck that calls your app:

```javascript
import { test, expect } from '@playwright/test';

test('distributed trace test', async ({ page }) => {
  // Call your instrumented app
  await page.goto('http://host.docker.internal:3001/api/users/789');

  // Verify response
  const content = await page.textContent('body');
  expect(content).toContain('User 789');
});
```

Run this test and view the trace - you'll see:
```
supercheck-worker (Playwright)
  └─ HTTP GET http://host.docker.internal:3001/api/users/789
      └─ my-test-app (Express)
          └─ fetch-user
              └─ db.query (SELECT * FROM users...)
```

**This is distributed tracing in action!** 🚀

---

## Viewing Traces in UI

### Navigate to Observability

1. Open Supercheck: `http://localhost:3000`
2. Go to sidebar → **Observability** → **Traces**

### Filter Traces

**By Service:**
- `supercheck-worker` - Playwright tests
- `my-test-app` - Your external app (if instrumented)

**By Supercheck Attributes:**
- `sc.run_id` - Specific test run
- `sc.test_id` - Specific test
- `sc.job_id` - Specific job
- `sc.run_type` - Type: `test`, `job`, `monitor`, `k6`

**By Time Range:**
- Last 1 hour
- Last 24 hours
- Last 7 days
- Custom range

**By Status:**
- Success
- Error
- All

### Trace Details

Click any trace to see:

- ✅ **Timeline**: Visual representation of spans
- ✅ **Span Details**: Attributes, events, errors
- ✅ **Duration**: Time spent in each operation
- ✅ **HTTP Requests**: Method, URL, status code
- ✅ **Database Queries**: SQL statements (if instrumented)
- ✅ **Errors**: Exception stack traces

### Example Trace Attributes

**Worker Traces:**
```
sc.run_id: 01JCABCD1234567890
sc.test_id: test_abc123
sc.run_type: test
service.name: supercheck-worker
http.method: GET
http.url: https://example.com/api/users
http.status_code: 200
```

**External App Traces:**
```
service.name: my-test-app
user.id: 123
db.system: postgresql
db.statement: SELECT * FROM users WHERE id = 123
```

---

## Troubleshooting

### Problem: Worker Shows DNS Resolution Error

**Error:**
```
Error: 14 UNAVAILABLE: Name resolution failed for target dns:otel-collector:4317
```

**Solution:**

This happens when running worker **locally** (not in Docker) with the wrong endpoint.

✅ **Fix for local development:**
```bash
# In worker/.env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317

# NOT this (Docker hostname):
# OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
```

✅ **Fix for Docker:**
```bash
# In docker-compose.yml (already set correctly)
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
```

### Problem: No Traces Appearing

**Diagnosis:**
```bash
# 1. Check if OTel Collector is receiving data
docker-compose logs otel-collector --tail=50

# 2. Check ClickHouse for traces
docker exec clickhouse-observability clickhouse-client \
  --query "SELECT count() FROM signoz_traces.signoz_index_v3"

# 3. Check recent traces
docker exec clickhouse-observability clickhouse-client \
  --query "SELECT serviceName, name, timestamp FROM signoz_traces.signoz_index_v3 ORDER BY timestamp DESC LIMIT 10" \
  --format=Pretty
```

**Solutions:**

- If count is **0**: OTel Collector not writing to ClickHouse
  - Check: `docker-compose logs otel-collector`
  - Verify ClickHouse is healthy: `curl http://localhost:8124/ping`

- If count **> 0** but UI shows nothing:
  - Check time range filter in UI
  - Try refreshing the page
  - Check ClickHouse URL in app: `CLICKHOUSE_URL=http://localhost:8124`

- If Collector logs show **connection errors**:
  - Verify endpoint: `telnet localhost 4317`
  - Check network: `docker network ls`

### Problem: Worker Instrumentation Not Loaded

**Diagnosis:**
```bash
# Check worker logs
docker-compose logs worker | grep Observability

# Local worker:
cd worker && npm run dev 2>&1 | grep Observability
```

**Expected:**
```
[Observability] Worker observability initialized successfully
[Observability] Service: supercheck-worker v1.0.0
```

**If missing:**

1. Check `worker/src/main.ts` has instrumentation import at the top:
   ```typescript
   import './observability/instrumentation';
   ```

2. Check environment variable:
   ```bash
   # In worker/.env
   ENABLE_WORKER_OBSERVABILITY=true
   ```

3. Rebuild (if Docker):
   ```bash
   docker-compose build worker
   docker-compose up -d worker
   ```

### Problem: Traces Not Linked (No Distributed Tracing)

**Symptoms:**
- Worker traces separate from app traces
- No parent-child relationship

**Solutions:**

1. Ensure **both** services send to same OTel Collector
2. Ensure app is **instrumented** with OpenTelemetry
3. Check trace context propagation (HTTP headers):
   ```bash
   # Should see 'traceparent' header in requests
   docker-compose logs worker | grep traceparent
   ```

### Problem: High Resource Usage

**Solution: Adjust Sampling**

```bash
# Reduce sampling to 10% (collect 1 in 10 traces)
OTEL_TRACE_SAMPLE_RATE=0.1

# For very high traffic, use 1%
OTEL_TRACE_SAMPLE_RATE=0.01
```

**Restart services after changing:**
```bash
docker-compose restart worker
```

### Common ClickHouse Queries

**Count traces by service:**
```bash
docker exec clickhouse-observability clickhouse-client --query \
  "SELECT serviceName, count() as total FROM signoz_traces.signoz_index_v3 GROUP BY serviceName"
```

**Find traces for specific run:**
```bash
docker exec clickhouse-observability clickhouse-client --query \
  "SELECT trace_id, name, timestamp FROM signoz_traces.signoz_index_v3
   WHERE stringTagMap['sc.run_id'] = 'YOUR_RUN_ID'
   ORDER BY timestamp DESC" --format=Pretty
```

**Delete old traces (30+ days):**
```bash
docker exec clickhouse-observability clickhouse-client --query \
  "ALTER TABLE signoz_traces.signoz_index_v3 DELETE WHERE timestamp < now() - INTERVAL 30 DAY"
```

---

## Environment Variables Reference

### Worker Service

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_WORKER_OBSERVABILITY` | `true` | Master ON/OFF switch for instrumentation |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | OTel Collector gRPC endpoint |
| `OTEL_SERVICE_NAME` | `supercheck-worker` | Service name in traces |
| `SERVICE_VERSION` | `1.0.0` | Service version (auto-detected from package.json) |
| `OTEL_LOG_LEVEL` | `error` | SDK log level (`none`, `error`, `warn`, `info`, `debug`) |
| `OTEL_TRACE_SAMPLE_RATE` | `1.0` | Sampling rate (1.0 = 100%, 0.1 = 10%) |
| `CLICKHOUSE_URL` | `http://clickhouse-observability:8123` | ClickHouse HTTP endpoint |
| `CLICKHOUSE_USER` | `default` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | `` | ClickHouse password (empty for local dev) |
| `CLICKHOUSE_DATABASE` | `default` | Default database |
| `USE_CLICKHOUSE_DIRECT` | `true` | Query ClickHouse directly (recommended) |

### App Service

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_CLICKHOUSE_DIRECT` | `true` | Query ClickHouse directly vs SigNoz API |
| `CLICKHOUSE_URL` | `http://clickhouse-observability:8123` | ClickHouse HTTP endpoint |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | OTel Collector endpoint |
| `ENABLE_WORKER_OBSERVABILITY` | `true` | Control worker instrumentation from app |

### Local Development vs Docker

**Local Development (.env):**
```bash
# Use localhost for local services
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
CLICKHOUSE_URL=http://localhost:8124
```

**Docker (docker-compose.yml):**
```bash
# Use Docker service names
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
CLICKHOUSE_URL=http://clickhouse-observability:8123
```

---

## Advanced Usage

### Custom Spans in Playwright Tests

You can add custom spans to your Playwright tests for better observability:

```javascript
import { test, expect } from '@playwright/test';
import { trace } from '@opentelemetry/api';

test('checkout with custom tracking', async ({ page }) => {
  const tracer = trace.getTracer('playwright-tests');

  await tracer.startActiveSpan('user-checkout', async (span) => {
    span.setAttribute('test.feature', 'checkout');
    span.setAttribute('test.environment', 'staging');

    await page.goto('https://example.com/checkout');

    // Add business context
    span.setAttribute('checkout.total', 149.99);
    span.setAttribute('checkout.items', 3);

    // Your test code...

    span.setStatus({ code: 0 }); // OK
    span.end();
  });
});
```

### Disable Instrumentation for Specific Tests

```bash
# Temporarily disable for debugging
ENABLE_WORKER_OBSERVABILITY=false npm run dev
```

### Performance Tuning

**High Traffic (reduce overhead):**
```bash
# Sample 10% of traces
OTEL_TRACE_SAMPLE_RATE=0.1

# Lower log level
OTEL_LOG_LEVEL=error
```

**Debugging (maximum visibility):**
```bash
# Capture all traces
OTEL_TRACE_SAMPLE_RATE=1.0

# Verbose logging
OTEL_LOG_LEVEL=debug
```

### Data Retention

ClickHouse stores all traces indefinitely by default. For production:

```bash
# Delete traces older than 30 days (run monthly)
docker exec clickhouse-observability clickhouse-client --query \
  "ALTER TABLE signoz_traces.signoz_index_v3 DELETE WHERE timestamp < now() - INTERVAL 30 DAY"

# Optimize table after deletion
docker exec clickhouse-observability clickhouse-client --query \
  "OPTIMIZE TABLE signoz_traces.signoz_index_v3 FINAL"
```

### Production Security

For production deployments:

1. **Set ClickHouse password:**
   ```bash
   CLICKHOUSE_PASSWORD=your-strong-password
   ```

2. **Remove external port exposures:**
   ```yaml
   # In docker-compose.yml - comment out public ports
   clickhouse-observability:
     # ports:
     #   - "8124:8123"
     #   - "9001:9000"
   ```

3. **Keep OTel Collector accessible (for external apps):**
   ```yaml
   otel-collector:
     ports:
       - "4317:4317"  # Keep for external app instrumentation
       - "4318:4318"  # Keep for browser/HTTP clients
   ```

4. **Use sampling in production:**
   ```bash
   OTEL_TRACE_SAMPLE_RATE=0.1  # 10% sampling
   ```

---

## Configuration Files

Essential configuration files in `observability/deploy/`:

```
observability/deploy/
├── README.md                           # Config documentation
├── common/clickhouse/
│   ├── config.xml                      # ClickHouse server config
│   ├── users.xml                       # User authentication
│   ├── custom-function.xml             # Custom SQL functions
│   ├── cluster-standalone.xml          # Single-node cluster (no Zookeeper)
│   └── user_scripts/histogramQuantile  # Quantile calculation UDF
└── docker/
    └── otel-collector-config.yaml      # OTel Collector pipelines
```

**Do not modify these files unless you know what you're doing.**

---

## Summary

✅ **Automatic**: Playwright tests traced automatically
✅ **Distributed**: See complete journey from test → app → database
✅ **Custom Attributes**: Filter by run_id, test_id, job_id
✅ **Zero Config**: Works out of the box
✅ **Toggle**: Easy enable/disable
✅ **Low Overhead**: <1ms per operation
✅ **Scalable**: Sampling support for high traffic
✅ **Secure**: No PII captured, environment-based config

---

## Need Help?

**Check logs:**
```bash
docker-compose logs clickhouse-observability
docker-compose logs otel-collector
docker-compose logs worker | grep Observability
```

**Verify health:**
```bash
curl http://localhost:8124/ping        # ClickHouse
curl http://localhost:13133/           # OTel Collector
telnet localhost 4317                  # OTel gRPC
```

**Query directly:**
```bash
docker exec clickhouse-observability clickhouse-client \
  --query "SELECT count() FROM signoz_traces.signoz_index_v3"
```

---

**Happy Tracing!** 🔍✨

For issues or questions, check the troubleshooting section above or review service logs.
