# ClickHouse Query Examples for SuperCheck Observability

This document contains useful ClickHouse queries for analyzing observability data.

## 📊 Table of Contents

- [Basic Queries](#basic-queries)
- [Trace Analysis](#trace-analysis)
- [Performance Metrics](#performance-metrics)
- [Error Analysis](#error-analysis)
- [Service Analysis](#service-analysis)
- [SuperCheck-Specific Queries](#supercheck-specific-queries)

## 🔍 Basic Queries

### Count traces by status

```sql
SELECT
    status_code,
    CASE
        WHEN status_code = 0 THEN 'UNSET'
        WHEN status_code = 1 THEN 'OK'
        WHEN status_code = 2 THEN 'ERROR'
    END AS status_name,
    count() AS total
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND parent_span_id = ''  -- Root spans only
GROUP BY status_code
ORDER BY total DESC;
```

### Recent traces

```sql
SELECT
    trace_id,
    name,
    service_name,
    duration_nano / 1000000 AS duration_ms,
    timestamp
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND parent_span_id = ''
ORDER BY timestamp DESC
LIMIT 50;
```

## 🔬 Trace Analysis

### Get all spans for a specific trace

```sql
SELECT
    span_id,
    parent_span_id,
    name,
    service_name,
    duration_nano / 1000000 AS duration_ms,
    status_code,
    timestamp
FROM signoz.signoz_traces
WHERE trace_id = 'YOUR_TRACE_ID'
ORDER BY timestamp;
```

### Find traces by run ID

```sql
-- Helper function to extract attribute
CREATE OR REPLACE FUNCTION getStringAttribute(
    keys Array(String),
    values Array(String),
    key String
) AS (
    values[indexOf(keys, key)]
);

-- Query traces by run_id
SELECT
    trace_id,
    name,
    service_name,
    duration_nano / 1000000 AS duration_ms,
    getStringAttribute(string_key, string_value, 'sc.run_id') AS run_id,
    getStringAttribute(string_key, string_value, 'sc.run_type') AS run_type,
    getStringAttribute(string_key, string_value, 'sc.test_name') AS test_name
FROM signoz.signoz_traces
WHERE getStringAttribute(string_key, string_value, 'sc.run_id') = 'run-789'
  AND parent_span_id = ''
ORDER BY timestamp;
```

### Trace duration distribution

```sql
SELECT
    quantile(0.50)(duration_nano / 1000000) AS p50_ms,
    quantile(0.95)(duration_nano / 1000000) AS p95_ms,
    quantile(0.99)(duration_nano / 1000000) AS p99_ms,
    max(duration_nano / 1000000) AS max_ms,
    avg(duration_nano / 1000000) AS avg_ms
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND parent_span_id = '';
```

## ⚡ Performance Metrics

### Top 10 slowest endpoints

```sql
SELECT
    name,
    service_name,
    quantile(0.95)(duration_nano / 1000000) AS p95_ms,
    quantile(0.99)(duration_nano / 1000000) AS p99_ms,
    count() AS count,
    countIf(status_code = 2) AS errors
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND parent_span_id = ''  -- Root spans only
GROUP BY name, service_name
ORDER BY p99_ms DESC
LIMIT 10;
```

### Service latency over time (1-minute buckets)

```sql
SELECT
    service_name,
    toStartOfMinute(timestamp) AS minute,
    quantile(0.95)(duration_nano / 1000000) AS p95_latency_ms,
    quantile(0.99)(duration_nano / 1000000) AS p99_latency_ms,
    avg(duration_nano / 1000000) AS avg_latency_ms,
    count() AS request_count
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND parent_span_id = ''
GROUP BY service_name, minute
ORDER BY minute, service_name;
```

### Throughput by service

```sql
SELECT
    service_name,
    count() AS total_requests,
    count() / 3600 AS requests_per_second
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND parent_span_id = ''
GROUP BY service_name
ORDER BY total_requests DESC;
```

## ❌ Error Analysis

### Error rate by service

```sql
SELECT
    service_name,
    toStartOfHour(timestamp) AS hour,
    count() AS total,
    countIf(status_code = 2) AS errors,
    (errors / total) * 100 AS error_rate_percent
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 24 HOUR
  AND parent_span_id = ''
GROUP BY service_name, hour
ORDER BY error_rate_percent DESC;
```

### Recent errors with details

```sql
SELECT
    trace_id,
    span_id,
    name,
    service_name,
    status_message,
    duration_nano / 1000000 AS duration_ms,
    timestamp,
    string_key,
    string_value
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND status_code = 2
ORDER BY timestamp DESC
LIMIT 100;
```

### Error patterns by operation

```sql
SELECT
    name AS operation,
    count() AS error_count,
    arrayStringConcat(
        arrayDistinct(
            arrayMap(
                (k, v) -> concat(k, '=', v),
                string_key,
                string_value
            )
        ),
        ', '
    ) AS common_attributes
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 24 HOUR
  AND status_code = 2
GROUP BY name
ORDER BY error_count DESC
LIMIT 20;
```

## 🔧 Service Analysis

### Service call graph (dependencies)

```sql
SELECT
    parent_service,
    child_service,
    count() AS call_count,
    avg(duration_nano / 1000000) AS avg_duration_ms
FROM (
    SELECT
        parent.service_name AS parent_service,
        child.service_name AS child_service,
        child.duration_nano
    FROM signoz.signoz_traces AS child
    INNER JOIN signoz.signoz_traces AS parent
        ON child.parent_span_id = parent.span_id
    WHERE child.timestamp > now() - INTERVAL 1 HOUR
)
GROUP BY parent_service, child_service
ORDER BY call_count DESC;
```

### Service availability (uptime)

```sql
SELECT
    service_name,
    toStartOfHour(timestamp) AS hour,
    count() AS total_requests,
    countIf(status_code = 1) AS successful,
    (successful / total_requests) * 100 AS availability_percent
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 24 HOUR
  AND parent_span_id = ''
GROUP BY service_name, hour
ORDER BY hour DESC, service_name;
```

## 🎯 SuperCheck-Specific Queries

### Playwright test execution metrics

```sql
SELECT
    getStringAttribute(string_key, string_value, 'sc.test_name') AS test_name,
    count() AS executions,
    countIf(status_code = 2) AS failures,
    (failures / executions) * 100 AS failure_rate,
    avg(duration_nano / 1000000) AS avg_duration_ms,
    quantile(0.95)(duration_nano / 1000000) AS p95_duration_ms
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 24 HOUR
  AND getStringAttribute(string_key, string_value, 'sc.run_type') = 'playwright'
  AND parent_span_id = ''
GROUP BY test_name
ORDER BY executions DESC;
```

### K6 performance test results

```sql
SELECT
    getStringAttribute(string_key, string_value, 'sc.test_name') AS test_name,
    toStartOfHour(timestamp) AS hour,
    count() AS iterations,
    quantile(0.95)(duration_nano / 1000000) AS p95_latency,
    quantile(0.99)(duration_nano / 1000000) AS p99_latency,
    countIf(status_code = 2) AS errors
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 24 HOUR
  AND getStringAttribute(string_key, string_value, 'sc.run_type') = 'k6'
GROUP BY test_name, hour
ORDER BY hour DESC, test_name;
```

### Monitor check success rate

```sql
SELECT
    getStringAttribute(string_key, string_value, 'sc.monitor_id') AS monitor_id,
    getStringAttribute(string_key, string_value, 'sc.monitor_type') AS monitor_type,
    count() AS total_checks,
    countIf(status_code = 1) AS successful_checks,
    countIf(status_code = 2) AS failed_checks,
    (successful_checks / total_checks) * 100 AS success_rate,
    avg(duration_nano / 1000000) AS avg_response_time_ms
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 24 HOUR
  AND getStringAttribute(string_key, string_value, 'sc.run_type') = 'monitor'
  AND parent_span_id = ''
GROUP BY monitor_id, monitor_type
ORDER BY success_rate;
```

### Job execution timeline

```sql
SELECT
    getStringAttribute(string_key, string_value, 'sc.job_id') AS job_id,
    getStringAttribute(string_key, string_value, 'sc.job_name') AS job_name,
    timestamp AS started_at,
    duration_nano / 1000000 AS duration_ms,
    status_code,
    CASE
        WHEN status_code = 1 THEN 'SUCCESS'
        WHEN status_code = 2 THEN 'FAILED'
        ELSE 'UNKNOWN'
    END AS status
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 7 DAY
  AND getStringAttribute(string_key, string_value, 'sc.run_type') = 'job'
  AND parent_span_id = ''
ORDER BY timestamp DESC;
```

### Regional performance comparison

```sql
SELECT
    getStringAttribute(string_key, string_value, 'sc.region') AS region,
    count() AS executions,
    avg(duration_nano / 1000000) AS avg_latency_ms,
    quantile(0.95)(duration_nano / 1000000) AS p95_latency_ms,
    countIf(status_code = 2) AS errors,
    (errors / executions) * 100 AS error_rate
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 24 HOUR
  AND parent_span_id = ''
  AND getStringAttribute(string_key, string_value, 'sc.region') != ''
GROUP BY region
ORDER BY avg_latency_ms;
```

## 📈 Advanced Queries

### Database query performance

```sql
SELECT
    arrayElement(string_value, indexOf(string_key, 'db.statement')) AS query,
    arrayElement(string_value, indexOf(string_key, 'db.system')) AS db_system,
    count() AS executions,
    avg(duration_nano / 1000000) AS avg_ms,
    quantile(0.95)(duration_nano / 1000000) AS p95_ms,
    max(duration_nano / 1000000) AS max_ms
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND has(string_key, 'db.statement')
GROUP BY query, db_system
ORDER BY avg_ms DESC
LIMIT 20;
```

### HTTP endpoint analysis

```sql
SELECT
    arrayElement(string_value, indexOf(string_key, 'http.route')) AS route,
    arrayElement(string_value, indexOf(string_key, 'http.method')) AS method,
    count() AS requests,
    countIf(status_code = 2) AS errors,
    avg(duration_nano / 1000000) AS avg_latency_ms,
    quantile(0.95)(duration_nano / 1000000) AS p95_latency_ms
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND has(string_key, 'http.route')
GROUP BY route, method
ORDER BY requests DESC;
```

### Trace sampling (for large datasets)

```sql
-- Sample 10% of traces for analysis
SELECT
    trace_id,
    name,
    duration_nano / 1000000 AS duration_ms,
    service_name
FROM signoz.signoz_traces
WHERE timestamp > now() - INTERVAL 24 HOUR
  AND parent_span_id = ''
  AND cityHash64(trace_id) % 10 = 0  -- 10% sample
ORDER BY timestamp DESC;
```

## 🧹 Maintenance Queries

### Table size and row counts

```sql
SELECT
    table,
    formatReadableSize(total_bytes) AS size,
    formatReadableQuantity(total_rows) AS rows,
    formatReadableSize(total_bytes / total_rows) AS avg_row_size
FROM system.tables
WHERE database = 'signoz'
  AND table LIKE 'signoz_%'
ORDER BY total_bytes DESC;
```

### Data retention check

```sql
SELECT
    min(timestamp) AS oldest_data,
    max(timestamp) AS newest_data,
    dateDiff('hour', oldest_data, newest_data) AS retention_hours
FROM signoz.signoz_traces;
```

### Partition information

```sql
SELECT
    partition,
    formatReadableSize(bytes_on_disk) AS size,
    rows,
    min_time,
    max_time
FROM system.parts
WHERE database = 'signoz'
  AND table = 'signoz_traces'
  AND active
ORDER BY partition DESC;
```

## 💡 Tips

1. **Always use time filters** - ClickHouse is optimized for time-series queries
2. **Use materialized views** - For frequently-run aggregations
3. **Index on trace_id and service_name** - Already configured in schema
4. **Optimize GROUP BY** - Use low-cardinality columns
5. **Sample large datasets** - Use `cityHash64() % N` for sampling

## 🔗 Resources

- [ClickHouse SQL Reference](https://clickhouse.com/docs/en/sql-reference/)
- [Query Optimization](https://clickhouse.com/docs/en/guides/improving-query-performance/)
- [Array Functions](https://clickhouse.com/docs/en/sql-reference/functions/array-functions/)

---

**Need help?** Check the [main README](./README.md) or open an issue.
