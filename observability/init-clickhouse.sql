-- Initialize ClickHouse databases for SigNoz
-- This creates the basic databases needed for observability data

CREATE DATABASE IF NOT EXISTS signoz_traces;
CREATE DATABASE IF NOT EXISTS signoz_metrics;
CREATE DATABASE IF NOT EXISTS signoz_logs;

-- Verify databases were created
SHOW DATABASES;
