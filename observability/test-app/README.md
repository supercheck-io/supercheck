# SigNoz Test Application

A simple Express.js application to test OpenTelemetry instrumentation with SigNoz.

## Prerequisites

- Node.js 18+ installed
- SigNoz stack running (see `../deploy/docker`)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start SigNoz (if not already running)

```bash
cd ../deploy/docker
docker compose up -d
```

### 3. Run the Test App

```bash
npm start
```

The app will start on http://localhost:3333

## Test Endpoints

### Basic Health Check
```bash
curl http://localhost:3333/health
```

### Get Users (with DB span)
```bash
curl http://localhost:3333/users
```

### Process Data (nested spans)
```bash
curl -X POST http://localhost:3333/process \
  -H "Content-Type: application/json" \
  -d '{"data":"test-data"}'
```

### Trigger Error (error tracking)
```bash
curl http://localhost:3333/error
```

## Generate Load for Testing

```bash
# Generate 100 requests
for i in {1..100}; do
  curl -s http://localhost:3333/users > /dev/null
  curl -s http://localhost:3333/health > /dev/null
  sleep 0.1
done
```

## View Telemetry in SigNoz

1. Open http://localhost:8080 in your browser
2. Navigate to **Traces** tab
3. You should see traces from `signoz-test-app`
4. Click on any trace to see:
   - Request duration
   - Span hierarchy
   - Custom attributes
   - Errors (if any)

## What This App Demonstrates

✅ **Automatic Instrumentation**
- HTTP server spans (Express)
- HTTP client spans (if you make external requests)

✅ **Manual Instrumentation**
- Custom spans (`fetch-users-from-db`)
- Nested spans (`process-data` with child spans)
- Custom attributes (db.system, db.table, etc.)

✅ **Error Tracking**
- Exception recording with `span.recordException()`
- Error status codes

✅ **Metrics** (auto-collected)
- Request rate
- Request duration
- Error rate

## Expected Data in SigNoz

After making requests, you should see:

**Traces:**
- Service name: `signoz-test-app`
- Spans: GET /users, POST /process, etc.
- Custom attributes on spans

**Logs:**
- Console logs from the application
- Correlated with trace IDs

**Metrics:**
- http.server.duration
- http.server.request.count
- process.runtime.nodejs.memory.usage

## Troubleshooting

### No traces appearing?

1. Check OTel Collector is running:
   ```bash
   docker logs signoz-otel-collector --tail 20
   ```

2. Verify endpoint is reachable:
   ```bash
   curl http://localhost:4318
   ```

3. Check app logs for instrumentation messages:
   ```
   🔧 Initializing OpenTelemetry instrumentation...
   ✅ OpenTelemetry SDK started
   📡 Sending telemetry to http://localhost:4318
   ```

### Port conflict?

Change the port in `index.js`:
```javascript
const PORT = 3334; // or any available port
```

## Next Steps

Use this as a template for instrumenting your own applications:

1. Copy `instrumentation.js` to your project
2. Update service name and version
3. Import instrumentation before your main app code
4. Add custom spans for important operations
5. Deploy and monitor in SigNoz!
