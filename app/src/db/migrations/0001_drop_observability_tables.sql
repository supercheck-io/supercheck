-- Drop observability tables and their dependent objects
-- These tables are no longer used after removing OTEL observability features

DROP TABLE IF EXISTS "observability_trace_bookmarks" CASCADE;
DROP TABLE IF EXISTS "observability_service_catalog" CASCADE;
DROP TABLE IF EXISTS "observability_saved_queries" CASCADE;
DROP TABLE IF EXISTS "observability_dashboards" CASCADE;
DROP TABLE IF EXISTS "observability_alert_incidents" CASCADE;
DROP TABLE IF EXISTS "observability_alert_rules" CASCADE;
