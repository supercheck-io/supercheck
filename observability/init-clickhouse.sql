-- Initialize ClickHouse databases for SigNoz
-- This creates the basic databases needed for observability data

CREATE DATABASE IF NOT EXISTS signoz_traces;
CREATE DATABASE IF NOT EXISTS signoz_metrics;
CREATE DATABASE IF NOT EXISTS signoz_logs;
CREATE DATABASE IF NOT EXISTS signoz_meter;

-- Create basic tables for traces (SigNoz will create detailed schema)
CREATE TABLE IF NOT EXISTS signoz_traces.signoz_index_v3 (
    timestamp DateTime64(9) CODEC(DoubleDelta, LZ4),
    traceID FixedString(32) CODEC(ZSTD(1)),
    spanID String CODEC(ZSTD(1)),
    parentSpanID String CODEC(ZSTD(1)),
    serviceName LowCardinality(String) CODEC(ZSTD(1)),
    name LowCardinality(String) CODEC(ZSTD(1)),
    kind Int8 CODEC(T64, ZSTD(1)),
    durationNano UInt64 CODEC(T64, ZSTD(1)),
    statusCode Int16 CODEC(T64, ZSTD(1)),
    component LowCardinality(String) CODEC(ZSTD(1)),
    httpMethod LowCardinality(String) CODEC(ZSTD(1)),
    httpUrl LowCardinality(String) CODEC(ZSTD(1)),
    httpCode LowCardinality(String) CODEC(ZSTD(1)),
    httpRoute LowCardinality(String) CODEC(ZSTD(1)),
    httpHost LowCardinality(String) CODEC(ZSTD(1)),
    gRPCMethod LowCardinality(String) CODEC(ZSTD(1)),
    gRPCCode LowCardinality(String) CODEC(ZSTD(1)),
    hasError Bool CODEC(T64, ZSTD(1))
) ENGINE = MergeTree()
PARTITION BY toDate(timestamp)
ORDER BY (serviceName, hasError, toStartOfHour(timestamp), name)
TTL toDateTime(timestamp) + INTERVAL 168 HOUR DELETE
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- Verify databases were created
SHOW DATABASES;

