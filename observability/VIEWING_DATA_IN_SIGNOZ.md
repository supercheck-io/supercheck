# Viewing Telemetry Data in SigNoz UI

Quick guide to navigate the SigNoz UI and find your traces, logs, and metrics.

## 🌐 Access the UI

Open http://localhost:8080 in your browser.

---

## 📊 Traces Tab

### Finding Your Traces

1. Click **"Traces"** in the left sidebar
2. You'll see a list of recent traces with:
   - Service name (`signoz-test-app`, `test-service`)
   - Operation name (e.g., `GET /users`, `POST /process`)
   - Duration
   - Status (success/error)
   - Timestamp

### Filtering Traces

**By Service:**
```
Click "Service" dropdown → Select "signoz-test-app"
```

**By Operation:**
```
Click "Operation" dropdown → Select "GET /users"
```

**By Status:**
```
Click "Status" dropdown → Select "error" (to see only failed traces)
```

**By Time Range:**
```
Top right corner → Select "Last 15 minutes" / "Last 1 hour" / Custom
```

### Viewing Trace Details

Click on any trace to see:

**Flame Graph:**
- Visual timeline of spans
- Color-coded by service
- Hover for timing details

**Span List:**
- Hierarchical view of all spans
- Parent-child relationships
- Individual span durations

**Span Details (click any span):**
- **Tags**: Custom attributes (e.g., `http.method: GET`, `db.table: users`)
- **Events**: Exceptions, logs
- **Duration**: Start/end times
- **Status**: OK/ERROR

### Example: View Nested Spans

For the `/process` endpoint, you should see:
```
POST /process (98ms)
  ├─ process-data (93ms)
  │   ├─ validate-input (21ms)
  │   ├─ transform-data (30ms)
  │   └─ save-to-storage (41ms)
```

---

## 📝 Logs Tab

### Finding Your Logs

1. Click **"Logs"** in the left sidebar
2. You'll see a stream of log entries with:
   - Timestamp
   - Severity (INFO, ERROR, WARN)
   - Message body
   - Service name
   - Trace ID (if correlated)

### Filtering Logs

**By Service:**
```
Add filter: service.name = signoz-test-app
```

**By Severity:**
```
Add filter: severity_text = ERROR
```

**By Trace ID (to correlate with trace):**
```
Click on any log → "View Trace" button
```

### Log Correlation with Traces

**From Log → Trace:**
1. Click on a log entry
2. Click **"View Trace"** button in details panel
3. Opens the full trace that generated this log

**From Trace → Logs:**
1. Open a trace
2. Click on a span
3. Click **"Logs"** tab in span details
4. See all logs emitted during this span

---

## 📈 Metrics Tab (Services)

### Viewing Service Metrics

1. Click **"Services"** in the left sidebar
2. You'll see a list of services with:
   - **RED metrics** (Rate, Error, Duration)
   - Request rate (requests/second)
   - Error rate (%)
   - P99 latency

### Service Overview

Click on **"signoz-test-app"** to see:

**Top-level Metrics:**
- Request throughput over time
- Error rate over time
- Latency (P50, P90, P95, P99)

**Endpoint Breakdown:**
- `/users` - request count, avg duration
- `/process` - request count, avg duration
- `/error` - request count, error rate

**Infrastructure Metrics:**
- CPU usage
- Memory usage (if configured)

---

## 📉 Custom Metrics (Metrics Explorer)

### Viewing Raw Metrics

1. Click **"Metrics"** in the left sidebar
2. Select metric name from dropdown:
   - `http.server.duration`
   - `http.client.duration`
   - `process.runtime.nodejs.memory.usage`

### Creating Custom Queries

**Example: Average request duration by endpoint**
```
Metric: http.server.duration
Aggregation: avg
Group by: http.route
```

**Example: Request rate per service**
```
Metric: http.server.request.count
Aggregation: rate
Group by: service.name
```

---

## 🗺️ Service Map

### Visualizing Service Dependencies

1. Click **"Service Map"** in the left sidebar
2. You'll see a graph of services and their connections:
   - Nodes = Services (e.g., `signoz-test-app`)
   - Edges = Calls between services
   - Edge labels = Request rate, error rate

**For SuperCheck:**
```
supercheck-app → supercheck-worker
               → postgresql
               → redis
               → minio
```

---

## 🔍 Searching for Specific Data

### Find a Test Run by Run ID

**In Traces:**
```
1. Go to Traces tab
2. Click "Add Filter"
3. Select "Tag" → "sc.run_id"
4. Enter your run ID
5. Click "Apply"
```

**In Logs:**
```
1. Go to Logs tab
2. Click "Add Filter"
3. Type: sc.run_id = <your-run-id>
4. Press Enter
```

### Find All Errors

**In Traces:**
```
1. Go to Traces tab
2. Click "Status" dropdown
3. Select "error"
```

**In Logs:**
```
1. Go to Logs tab
2. Add filter: severity_text = ERROR
```

### Find Slow Requests (P95 > 1s)

**In Traces:**
```
1. Go to Traces tab
2. Click "Duration" filter
3. Set min: 1000ms
4. Click "Apply"
```

---

## 📊 Creating Dashboards

### Custom Dashboard for SuperCheck

1. Click **"Dashboards"** in sidebar
2. Click **"+ New Dashboard"**
3. Add panels:

**Panel 1: Test Execution Rate**
```
Title: Tests Executed per Minute
Metric: http.server.request.count
Filter: http.route = /api/runs/execute
Aggregation: rate
```

**Panel 2: Test Success Rate**
```
Title: Test Success Rate (%)
Metric: http.server.request.count
Filter: sc.run_type = playwright
Aggregation: (success_count / total_count) * 100
```

**Panel 3: Worker Performance**
```
Title: Average Test Duration by Worker
Metric: http.server.duration
Group by: sc.worker_id
Aggregation: avg
```

---

## 🚨 Setting Up Alerts

### Create Alert for Failed Tests

1. Click **"Alerts"** in sidebar
2. Click **"+ New Alert"**
3. Configure:
   ```
   Alert Name: High Test Failure Rate
   Metric: http.server.request.count
   Filter: sc.run_type = playwright AND status = error
   Threshold: > 5 errors in 5 minutes
   Notification: Email / Slack / Webhook
   ```

### Create Alert for Slow Tests

```
Alert Name: Slow Test Execution
Metric: http.server.duration
Filter: sc.run_type = playwright
Aggregation: P95
Threshold: > 60000ms (60 seconds)
Notification: Email / Slack
```

---

## 🔗 Useful ClickHouse Queries

If you need to query ClickHouse directly:

### Get All Services
```sql
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT DISTINCT serviceName FROM signoz_traces.signoz_index_v3"
```

### Get Trace Count by Service
```sql
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT serviceName, COUNT(*) as count
   FROM signoz_traces.signoz_index_v3
   GROUP BY serviceName
   ORDER BY count DESC"
```

### Get Recent Errors
```sql
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT timestamp, serviceName, name, statusMessage
   FROM signoz_traces.signoz_index_v3
   WHERE hasError = true
   ORDER BY timestamp DESC
   LIMIT 10 FORMAT Vertical"
```

### Get Average Duration by Endpoint
```sql
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT
     name,
     COUNT(*) as count,
     AVG(durationNano)/1000000 as avg_duration_ms
   FROM signoz_traces.signoz_index_v3
   WHERE serviceName = 'signoz-test-app'
   GROUP BY name
   ORDER BY count DESC"
```

---

## 🎯 Quick Troubleshooting

### "No data available"

1. Check time range (top right) - extend to "Last 1 hour"
2. Clear all filters
3. Verify services are sending data:
   ```bash
   docker logs signoz-otel-collector --tail 50
   ```

### "Service not showing up"

1. Verify service name matches in instrumentation
2. Check if traces are in ClickHouse:
   ```bash
   docker exec signoz-clickhouse clickhouse-client --query \
     "SELECT DISTINCT serviceName FROM signoz_traces.signoz_index_v3"
   ```

### "Logs not correlated with traces"

Ensure your logs include trace context:
```typescript
import { trace, context } from '@opentelemetry/api';

const span = trace.getActiveSpan();
const traceId = span?.spanContext().traceId;
const spanId = span?.spanContext().spanId;

console.log({ traceId, spanId, message: 'Log message' });
```

---

## 📚 UI Navigation Shortcuts

| Feature | Location | Use Case |
|---------|----------|----------|
| **Traces** | Sidebar → Traces | View request traces, debug issues |
| **Logs** | Sidebar → Logs | View application logs |
| **Services** | Sidebar → Services | Monitor service health (RED metrics) |
| **Metrics** | Sidebar → Metrics | Query custom metrics |
| **Service Map** | Sidebar → Service Map | Visualize dependencies |
| **Dashboards** | Sidebar → Dashboards | Custom monitoring dashboards |
| **Alerts** | Sidebar → Alerts | Configure alerting rules |

---

## 🎓 Learning Path

**New to SigNoz?**

1. **Start with Traces** - Understand request flow
2. **Explore Service Map** - See service dependencies
3. **Check Services Tab** - Monitor RED metrics
4. **Correlate Logs** - Link logs to traces
5. **Create Dashboards** - Build custom views
6. **Set Up Alerts** - Get notified of issues

---

## 📖 Additional Resources

- **SigNoz Docs**: https://signoz.io/docs/
- **Trace Visualization**: https://signoz.io/docs/userguide/traces/
- **Log Management**: https://signoz.io/docs/userguide/logs/
- **Metrics Monitoring**: https://signoz.io/docs/userguide/metrics/
- **Alerting Guide**: https://signoz.io/docs/userguide/alerts/

---

**Happy Observing! 🔭**
