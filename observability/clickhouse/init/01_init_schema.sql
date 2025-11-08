-- ClickHouse initialization schema for SigNoz-compatible observability tables
-- This script creates the necessary tables for storing traces, logs, and metrics

-- Create database if not exists
CREATE DATABASE IF NOT EXISTS signoz;

USE signoz;

-- ============================================================================
-- TRACES TABLES
-- ============================================================================

-- Traces: Distributed tracing data
CREATE TABLE IF NOT EXISTS signoz_traces (
    timestamp DateTime64(9) CODEC(DoubleDelta, LZ4),
    trace_id String CODEC(ZSTD(1)),
    span_id String CODEC(ZSTD(1)),
    parent_span_id String CODEC(ZSTD(1)),
    name LowCardinality(String) CODEC(ZSTD(1)),
    service_name LowCardinality(String) CODEC(ZSTD(1)),
    kind Int8 CODEC(T64, ZSTD(1)),
    duration_nano UInt64 CODEC(T64, ZSTD(1)),
    status_code Int16 CODEC(T64, ZSTD(1)),
    status_message String CODEC(ZSTD(1)),

    -- Resource attributes
    resource_string_key Array(LowCardinality(String)) CODEC(ZSTD(1)),
    resource_string_value Array(String) CODEC(ZSTD(1)),

    -- Span attributes
    string_key Array(LowCardinality(String)) CODEC(ZSTD(1)),
    string_value Array(String) CODEC(ZSTD(1)),
    number_key Array(LowCardinality(String)) CODEC(ZSTD(1)),
    number_value Array(Float64) CODEC(ZSTD(1)),
    bool_key Array(LowCardinality(String)) CODEC(ZSTD(1)),
    bool_value Array(UInt8) CODEC(ZSTD(1)),

    -- Events
    events Nested(
        name LowCardinality(String),
        timestamp_unix_nano UInt64,
        string_key Array(LowCardinality(String)),
        string_value Array(String)
    ) CODEC(ZSTD(1)),

    -- Links
    links Nested(
        trace_id String,
        span_id String,
        trace_state String,
        string_key Array(LowCardinality(String)),
        string_value Array(String)
    ) CODEC(ZSTD(1)),

    INDEX idx_trace_id trace_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_span_id span_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_service service_name TYPE set(100) GRANULARITY 4,
    INDEX idx_name name TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4,
    INDEX idx_duration duration_nano TYPE minmax GRANULARITY 1
) ENGINE = MergeTree()
PARTITION BY toDate(timestamp)
ORDER BY (service_name, timestamp, trace_id)
TTL toDateTime(timestamp) + INTERVAL 72 HOUR
SETTINGS index_granularity = 8192;

-- ============================================================================
-- LOGS TABLES
-- ============================================================================

-- Logs: Structured log data
CREATE TABLE IF NOT EXISTS signoz_logs (
    timestamp DateTime64(9) CODEC(DoubleDelta, LZ4),
    observed_timestamp DateTime64(9) CODEC(DoubleDelta, LZ4),
    trace_id String CODEC(ZSTD(1)),
    span_id String CODEC(ZSTD(1)),
    trace_flags UInt32 CODEC(ZSTD(1)),
    severity_text LowCardinality(String) CODEC(ZSTD(1)),
    severity_number Int32 CODEC(T64, ZSTD(1)),
    body String CODEC(ZSTD(1)),

    -- Resource attributes
    resource_string_key Array(LowCardinality(String)) CODEC(ZSTD(1)),
    resource_string_value Array(String) CODEC(ZSTD(1)),

    -- Log attributes
    string_key Array(LowCardinality(String)) CODEC(ZSTD(1)),
    string_value Array(String) CODEC(ZSTD(1)),
    number_key Array(LowCardinality(String)) CODEC(ZSTD(1)),
    number_value Array(Float64) CODEC(ZSTD(1)),

    INDEX idx_trace_id trace_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_span_id span_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_severity severity_text TYPE set(0) GRANULARITY 1,
    INDEX idx_body body TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4
) ENGINE = MergeTree()
PARTITION BY toDate(timestamp)
ORDER BY (severity_number, timestamp)
TTL toDateTime(timestamp) + INTERVAL 72 HOUR
SETTINGS index_granularity = 8192;

-- ============================================================================
-- METRICS TABLES
-- ============================================================================

-- Metrics: Time-series metrics data
CREATE TABLE IF NOT EXISTS signoz_metrics (
    metric_name LowCardinality(String) CODEC(ZSTD(1)),
    timestamp DateTime64(9) CODEC(DoubleDelta, LZ4),
    fingerprint UInt64 CODEC(Delta, ZSTD(1)),

    -- Metric type: 0=Gauge, 1=Sum, 2=Histogram, 3=Summary
    type Int8 CODEC(T64, ZSTD(1)),

    -- Values
    value Float64 CODEC(ZSTD(1)),
    count UInt64 CODEC(T64, ZSTD(1)),
    sum Float64 CODEC(ZSTD(1)),

    -- Histogram/Summary specific
    bucket_counts Array(UInt64) CODEC(ZSTD(1)),
    explicit_bounds Array(Float64) CODEC(ZSTD(1)),
    quantile_values Array(Float64) CODEC(ZSTD(1)),
    quantiles Array(Float64) CODEC(ZSTD(1)),

    -- Resource attributes
    resource_string_key Array(LowCardinality(String)) CODEC(ZSTD(1)),
    resource_string_value Array(String) CODEC(ZSTD(1)),

    -- Metric attributes (labels)
    string_key Array(LowCardinality(String)) CODEC(ZSTD(1)),
    string_value Array(String) CODEC(ZSTD(1)),

    INDEX idx_metric metric_name TYPE set(100) GRANULARITY 4,
    INDEX idx_fingerprint fingerprint TYPE set(100) GRANULARITY 4
) ENGINE = MergeTree()
PARTITION BY toDate(timestamp)
ORDER BY (metric_name, fingerprint, timestamp)
TTL toDateTime(timestamp) + INTERVAL 72 HOUR
SETTINGS index_granularity = 8192;

-- ============================================================================
-- MATERIALIZED VIEWS FOR PERFORMANCE
-- ============================================================================

-- Trace spans grouped by trace_id for faster lookups
CREATE MATERIALIZED VIEW IF NOT EXISTS signoz_traces_summary
ENGINE = AggregatingMergeTree()
PARTITION BY toDate(timestamp)
ORDER BY (trace_id, service_name, timestamp)
AS SELECT
    trace_id,
    service_name,
    min(timestamp) as min_timestamp,
    max(timestamp) as max_timestamp,
    max(duration_nano) as max_duration,
    count() as span_count,
    countIf(status_code = 2) as error_count,
    uniqState(name) as unique_operations
FROM signoz_traces
GROUP BY trace_id, service_name;

-- Service metrics aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS signoz_service_metrics
ENGINE = SummingMergeTree()
PARTITION BY toDate(timestamp)
ORDER BY (service_name, toStartOfMinute(timestamp))
AS SELECT
    service_name,
    toStartOfMinute(timestamp) as minute,
    count() as request_count,
    countIf(status_code = 2) as error_count,
    quantile(0.95)(duration_nano) as p95_latency,
    quantile(0.99)(duration_nano) as p99_latency,
    avg(duration_nano) as avg_latency
FROM signoz_traces
WHERE parent_span_id = ''
GROUP BY service_name, minute;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to extract SuperCheck-specific attributes
CREATE OR REPLACE FUNCTION getStringAttribute(keys Array(String), values Array(String), key String)
RETURNS String AS
$$
    SELECT values[indexOf(keys, key)]
$$;

-- ============================================================================
-- SAMPLE QUERIES (commented for reference)
-- ============================================================================

/*
-- Get traces for a specific run_id
SELECT
    trace_id,
    span_id,
    name,
    service_name,
    duration_nano / 1000000 as duration_ms,
    status_code,
    getStringAttribute(string_key, string_value, 'sc.run_id') as run_id,
    getStringAttribute(string_key, string_value, 'sc.run_type') as run_type
FROM signoz_traces
WHERE getStringAttribute(string_key, string_value, 'sc.run_id') = 'run_123'
ORDER BY timestamp;

-- Get error rate by service
SELECT
    service_name,
    toStartOfHour(timestamp) as hour,
    count() as total,
    countIf(status_code = 2) as errors,
    (errors / total) * 100 as error_rate
FROM signoz_traces
WHERE timestamp > now() - INTERVAL 24 HOUR
GROUP BY service_name, hour
ORDER BY hour DESC, error_rate DESC;

-- Get top slow endpoints
SELECT
    name,
    service_name,
    quantile(0.95)(duration_nano / 1000000) as p95_ms,
    quantile(0.99)(duration_nano / 1000000) as p99_ms,
    count() as count
FROM signoz_traces
WHERE parent_span_id = ''
  AND timestamp > now() - INTERVAL 1 HOUR
GROUP BY name, service_name
ORDER BY p99_ms DESC
LIMIT 10;
*/
