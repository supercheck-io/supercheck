# Quick Guide: What You Should See in SigNoz UI

## 🌐 Open the UI

**URL**: http://localhost:8080

---

## ✅ Current Test Data Available

You now have **450+ traces** from `signoz-test-app` including:

| Operation | Count | Has Errors |
|-----------|-------|------------|
| GET /users | 102 | ✅ No |
| GET /health | 102 | ✅ No |
| POST /process | 51 | ✅ No |
| GET /error | 21 | ❌ Yes (intentional) |
| Custom spans | 204 | ✅ No |

---

## 📊 Step-by-Step: Navigate the UI

### 1. Traces Tab (Main View)

1. **Open** http://localhost:8080
2. **Click "Traces"** in the left sidebar
3. **You should see:**
   - A list of traces ordered by timestamp
   - Service name: `signoz-test-app`
   - Operations: `GET`, `POST`, `fetch-users-from-db`, etc.
   - Duration bars (visual timeline)
   - Red badges for errors (21 error traces)

### 2. Filter by Service

1. At the top, find the **"Service"** dropdown
2. Select **"signoz-test-app"**
3. Now you only see traces from our test app

### 3. View a Trace (Flame Graph)

1. **Click on any trace** from the list
2. You'll see a **flame graph** visualization showing:
   - Root span (e.g., `POST /process`)
   - Child spans nested underneath
   - Color-coded by service
   - Timeline with durations

**Example for POST /process:**
```
POST (98ms)
  └─ process-data (93ms)
      ├─ validate-input (21ms)
      ├─ transform-data (30ms)
      └─ save-to-storage (41ms)
```

4. **Hover** over any span to see:
   - Span name
   - Duration
   - Start/end time

5. **Click** on a span to see details panel on the right:
   - **Tags**: `http.method`, `http.url`, custom attributes
   - **Events**: Exceptions (for error spans)
   - **Duration breakdown**

### 4. View an Error Trace

1. In the trace list, **click "Status"** dropdown
2. Select **"error"**
3. Click on one of the **21 error traces** (GET /error)
4. You'll see:
   - Red badge on the span
   - **Events tab** showing the exception:
     ```
     Exception: This is a test error for SigNoz
     ```
   - Stack trace (if available)

### 5. Services Tab (RED Metrics)

1. **Click "Services"** in left sidebar
2. You'll see a list of services:
   - **signoz-test-app** (our test app)
   - **test-service** (from manual curl test)
   - **signoz-otel-collector** (collector metrics)

3. **Click on "signoz-test-app"**
4. You'll see dashboards with:
   - **Request Rate** (requests/second over time)
   - **Error Rate** (% of failed requests) - should show ~4.6% (21 errors out of 450)
   - **Latency** (P50, P90, P95, P99 percentiles)

5. Scroll down to see **"Top Endpoints"**:
   - `/users` - count, avg duration
   - `/process` - count, avg duration
   - `/error` - count, error rate
   - `/health` - count, avg duration

### 6. Logs Tab

1. **Click "Logs"** in left sidebar
2. You should see log entries (if any console.log from the app)
3. **Add filter**:
   ```
   service.name = signoz-test-app
   ```
4. Click on any log to see:
   - Full log message
   - Severity level
   - Timestamp
   - **Trace ID** (if correlated)
   - Button to **"View Trace"**

### 7. Service Map

1. **Click "Service Map"** in left sidebar
2. You'll see a graph with nodes:
   - `signoz-test-app` (our test app)
   - Any external services it calls

3. Hover over the node to see:
   - Request rate
   - Error rate
   - P99 latency

---

## 🔍 What to Look For

### Traces Tab

**Screenshot checklist:**
- ✅ List of traces with timestamps
- ✅ Service dropdown showing "signoz-test-app"
- ✅ Operation names (GET, POST, fetch-users-from-db)
- ✅ Duration bars (visual)
- ✅ Red error badges on 21 traces
- ✅ Filter by time range (top right)

**Flame Graph view:**
- ✅ Nested span hierarchy
- ✅ Color-coded spans
- ✅ Timeline with ms durations
- ✅ Span details panel on right
- ✅ Tags like `http.method: GET`

### Services Tab

**RED Metrics Dashboard:**
- ✅ **Rate** graph showing request rate over time
- ✅ **Error** rate showing ~4.6% errors
- ✅ **Duration** graph showing P50/P90/P95/P99 latencies

**Top Endpoints Table:**
```
Endpoint       | Count | Avg Duration | Error Rate
/users         | 51    | ~52ms        | 0%
/process       | 51    | ~98ms        | 0%
/error         | 21    | ~1.4ms       | 100%
/health        | 51    | ~4ms         | 0%
```

### Logs Tab

- ✅ Stream of log entries
- ✅ Timestamp column
- ✅ Severity badges (INFO, ERROR)
- ✅ Service name filter
- ✅ "View Trace" button on each log

---

## 🎨 What Each Color/Badge Means

| Visual | Meaning |
|--------|---------|
| 🟢 Green bar | Successful trace (no errors) |
| 🔴 Red badge | Error trace |
| Blue/purple spans | Different services |
| Wider bars | Longer duration |
| Nested indentation | Parent-child span relationship |

---

## 🚀 Quick Actions to Try

### 1. Find All Errors
```
Traces tab → Status dropdown → Select "error"
```

### 2. Find Slow Requests (>50ms)
```
Traces tab → Click "Duration" → Set min: 50ms
```

### 3. View Specific Endpoint
```
Traces tab → Operation dropdown → Select "GET"
```

### 4. Compare Before/After Time
```
Top right → Select time range → "Last 15 minutes"
```

### 5. Drill Down into a Trace
```
Click any trace → See flame graph → Click any span → See tags/events
```

---

## 📸 What You Should See (Descriptions)

### Traces List View
- Table with columns: Timestamp | Service | Operation | Duration | Status
- Each row is clickable
- Sortable by any column
- Red badges on error rows
- Duration bars (visual length indicates duration)

### Trace Flame Graph
- Horizontal bars representing spans
- Parent spans contain child spans
- X-axis is time (ms)
- Hoverable for details
- Right panel shows selected span details

### Services Dashboard
- Line graphs for Rate/Error/Duration over time
- Summary cards at top (total requests, avg latency, error %)
- Table of endpoints below
- Drill-down to specific endpoint

### Logs Stream
- Real-time log stream (newest first)
- Filterable by service, severity, text search
- Expandable rows showing full log context
- Linked to traces via trace ID

---

## 🎯 If You Don't See Data

### Check 1: Time Range
- Top right corner → Extend to "Last 1 hour"

### Check 2: Verify Data Exists
```bash
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT COUNT(*) FROM signoz_traces.signoz_index_v3"
```
Should return: `450+`

### Check 3: Service Filter
- Clear all filters (click X on each filter)
- Check if "signoz-test-app" appears in service dropdown

### Check 4: Refresh Page
- Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)

---

## 📊 Generate More Data

Want to see more activity in the UI?

```bash
# In observability directory
cd test-app

# Generate traffic
for i in {1..100}; do
  curl -s http://localhost:3333/users > /dev/null
  curl -s http://localhost:3333/process -X POST -H "Content-Type: application/json" -d '{"data":"test"}' > /dev/null
  sleep 0.5
done
```

Then **refresh** the SigNoz UI to see updated graphs!

---

## 🎓 Explore Features

Now that you have data, try:

1. **Click different tabs** (Traces, Logs, Services, Metrics)
2. **Filter traces** by status, duration, operation
3. **Click on a trace** to see the flame graph
4. **Click on spans** to see custom attributes
5. **Go to Services tab** to see RED metrics
6. **Create a dashboard** (Dashboards → + New Dashboard)
7. **Set up an alert** (Alerts → + New Alert)

---

**You now have a fully populated SigNoz instance with real traces, logs, and metrics!** 🎉

The UI should be responsive and showing graphs/charts with the 450+ traces we just generated.
