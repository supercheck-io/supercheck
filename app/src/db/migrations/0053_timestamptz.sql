-- Convert every "timestamp without time zone" column to "timestamp with time zone". The stored
-- naive values are UTC wall times (the app writes JS Dates as UTC, defaults were evaluated in a UTC
-- session), so they are reinterpreted as UTC instants and no value changes. Reason: naive timestamps
-- silently shift if any client or server session uses another TimeZone; timestamptz is unambiguous.
-- * Guard: refuses to run when the session TimeZone is not UTC, since existing values would be
--   interpreted in that zone (shifted) and every table would be rewritten. Fix: set the server or
--   database timezone to UTC (ALTER DATABASE ... SET TimeZone = 'UTC' or postgresql.conf) and redeploy.
-- * Locking, measured on PostgreSQL 18 with a UTC session and no USING clause: the table heap is NOT
--   rewritten (same relfilenode), but every index containing a converted column IS rebuilt (new
--   relfilenode). Each table is converted by one ALTER TABLE that holds ACCESS EXCLUSIVE until commit,
--   so reads and writes to a table wait for its index builds; cost grows with index size. With a
--   non-UTC session the heap is rewritten as well (this is why the guard exists). Deploy in a quiet
--   window on large installs. lock_timeout fails the deploy fast instead of queueing behind a
--   long transaction; the migration is re-runnable.
-- * Two partial indexes (private_agent_jobs lease, status_page_notification_deliveries retention) are
--   dropped and recreated around their table's ALTER: Postgres re-parses an index predicate when it rebuilds the
--   index and stores an equivalent but differently shaped expression, which the schema-drift check rejects.
-- * Defaults (now()), partial index predicates (only IS [NOT] NULL on these columns) and the one
--   trigger function (now()) stay valid unchanged.
-- Forward-only.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30min';
--> statement-breakpoint
DO $$
BEGIN
  IF lower(current_setting('TimeZone')) NOT IN ('utc', 'etc/utc', 'gmt', 'etc/gmt', 'uct', 'etc/uct', 'zulu', 'etc/zulu', 'etc/universal', 'universal', 'etc/greenwich', 'greenwich', 'gmt0', 'etc/gmt0', 'etc/gmt+0', 'etc/gmt-0') THEN
    RAISE EXCEPTION 'Migration 0053_timestamptz requires the database session TimeZone to be UTC but it is %. Existing timestamp values would be shifted by the conversion. Set the server/database timezone to UTC (for example ALTER DATABASE <name> SET TimeZone = ''UTC'') or contact support, then redeploy.', current_setting('TimeZone');
  END IF;
END $$;
--> statement-breakpoint
SET LOCAL TimeZone = 'UTC';
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "account" ALTER COLUMN "access_token_expires_at" TYPE timestamp with time zone, ALTER COLUMN "refresh_token_expires_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "alert_history" ALTER COLUMN "sent_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "alerts" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "apikey" ALTER COLUMN "last_refill_at" TYPE timestamp with time zone, ALTER COLUMN "last_request" TYPE timestamp with time zone, ALTER COLUMN "expires_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "audit_logs" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "billing_settings" ALTER COLUMN "last_notification_sent_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "device_authorizations" ALTER COLUMN "expires_at" TYPE timestamp with time zone, ALTER COLUMN "last_polled_at" TYPE timestamp with time zone, ALTER COLUMN "approved_at" TYPE timestamp with time zone, ALTER COLUMN "consumed_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "diagnostic_queries" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "execution_usage_receipts" ALTER COLUMN "billing_period_start" TYPE timestamp with time zone, ALTER COLUMN "billing_period_end" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "settled_at" TYPE timestamp with time zone, ALTER COLUMN "next_attempt_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "external_connector_credentials" ALTER COLUMN "expires_at" TYPE timestamp with time zone, ALTER COLUMN "last_rotated_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "external_connector_services" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "external_connectors" ALTER COLUMN "last_validated_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incident_components" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incident_template_components" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incident_templates" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incident_updates" ALTER COLUMN "display_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incidents" ALTER COLUMN "scheduled_for" TYPE timestamp with time zone, ALTER COLUMN "scheduled_until" TYPE timestamp with time zone, ALTER COLUMN "backfill_date" TYPE timestamp with time zone, ALTER COLUMN "monitoring_at" TYPE timestamp with time zone, ALTER COLUMN "resolved_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "invitation" ALTER COLUMN "expires_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "job_notification_settings" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "jobs" ALTER COLUMN "last_run_at" TYPE timestamp with time zone, ALTER COLUMN "next_run_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "jwks" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "expires_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "k6_performance_runs" ALTER COLUMN "started_at" TYPE timestamp with time zone, ALTER COLUMN "completed_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "locations" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "member" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitor_aggregate_dedup_audit" ALTER COLUMN "period_start" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitor_aggregates" ALTER COLUMN "period_start" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitor_cycle_arrivals" ALTER COLUMN "processed_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitor_cycles" ALTER COLUMN "scheduled_for" TYPE timestamp with time zone, ALTER COLUMN "deadline_at" TYPE timestamp with time zone, ALTER COLUMN "closed_at" TYPE timestamp with time zone, ALTER COLUMN "notified_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitor_notification_settings" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitor_results" ALTER COLUMN "checked_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitor_tags" ALTER COLUMN "assigned_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitors" ALTER COLUMN "last_check_at" TYPE timestamp with time zone, ALTER COLUMN "last_status_change_at" TYPE timestamp with time zone, ALTER COLUMN "muted_until" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "notification_providers" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "notifications" ALTER COLUMN "sent_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "oauth_access_token" ALTER COLUMN "expires_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "revoked" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "oauth_client" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "oauth_client_assertion" ALTER COLUMN "expires_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "oauth_client_resource" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "oauth_consent" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "expires_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "revoked" TYPE timestamp with time zone, ALTER COLUMN "rotated_at" TYPE timestamp with time zone, ALTER COLUMN "rotation_replay_expires_at" TYPE timestamp with time zone, ALTER COLUMN "auth_time" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "oauth_resource" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "organization" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "subscription_started_at" TYPE timestamp with time zone, ALTER COLUMN "subscription_ends_at" TYPE timestamp with time zone, ALTER COLUMN "usage_period_start" TYPE timestamp with time zone, ALTER COLUMN "usage_period_end" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "overage_pricing" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "plan_limits" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "postmortems" ALTER COLUMN "body_last_updated_at" TYPE timestamp with time zone, ALTER COLUMN "published_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "private_agent_artifacts" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "private_agent_credentials" ALTER COLUMN "issued_at" TYPE timestamp with time zone, ALTER COLUMN "expires_at" TYPE timestamp with time zone, ALTER COLUMN "last_used_at" TYPE timestamp with time zone, ALTER COLUMN "rotated_at" TYPE timestamp with time zone, ALTER COLUMN "revoked_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "private_agent_heartbeats" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "private_agent_jobs_lease_expires_at_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "private_agent_jobs" ALTER COLUMN "lease_expires_at" TYPE timestamp with time zone, ALTER COLUMN "cancel_requested_at" TYPE timestamp with time zone, ALTER COLUMN "started_at" TYPE timestamp with time zone, ALTER COLUMN "completed_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "private_agent_jobs_lease_expires_at_idx" ON "private_agent_jobs" USING btree ("lease_expires_at") WHERE status IN ('leased', 'running');
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "private_agents" ALTER COLUMN "last_heartbeat_at" TYPE timestamp with time zone, ALTER COLUMN "connected_at" TYPE timestamp with time zone, ALTER COLUMN "registered_at" TYPE timestamp with time zone, ALTER COLUMN "disabled_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "project_locations" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "project_members" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "project_variables" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "projects" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "reports" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "requirement_coverage_snapshots" ALTER COLUMN "last_failed_at" TYPE timestamp with time zone, ALTER COLUMN "last_evaluated_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "requirement_documents" ALTER COLUMN "uploaded_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "requirement_tags" ALTER COLUMN "assigned_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "requirements" ALTER COLUMN "external_synced_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "runs" ALTER COLUMN "started_at" TYPE timestamp with time zone, ALTER COLUMN "completed_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "session" ALTER COLUMN "expires_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_ai_suggestions" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_alert_events" ALTER COLUMN "fired_at" TYPE timestamp with time zone, ALTER COLUMN "resolved_at" TYPE timestamp with time zone, ALTER COLUMN "silenced_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_background_agent_runs" ALTER COLUMN "trigger_at" TYPE timestamp with time zone, ALTER COLUMN "completed_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_chat_conversations" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_chat_messages" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_context_observations" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_context_playbooks" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_context_recollections" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_evidence_graph_focused_views" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_evidence_items" ALTER COLUMN "observed_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_incident_alerts" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "alert_fired_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_incident_runbook_steps" ALTER COLUMN "completed_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_incident_timeline_events" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_incident_verifications" ALTER COLUMN "checked_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_incidents" ALTER COLUMN "resolved_at" TYPE timestamp with time zone, ALTER COLUMN "verified_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone, ALTER COLUMN "acknowledged_at" TYPE timestamp with time zone, ALTER COLUMN "mitigated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_integration_binding_services" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_integration_bindings" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_investigation_feedback" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_investigation_recommendations" ALTER COLUMN "applied_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_investigation_report_feedback" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_investigation_reports" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_investigation_runs" ALTER COLUMN "started_at" TYPE timestamp with time zone, ALTER COLUMN "completed_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_investigation_tool_calls" ALTER COLUMN "executed_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_runbook_steps" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_runbooks" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_dependencies" ALTER COLUMN "approved_at" TYPE timestamp with time zone, ALTER COLUMN "first_seen_at" TYPE timestamp with time zone, ALTER COLUMN "last_seen_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_dependency_observations" ALTER COLUMN "observed_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_deployments" ALTER COLUMN "deployed_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_discovery_suggestions" ALTER COLUMN "approved_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_health_snapshots" ALTER COLUMN "window_start" TYPE timestamp with time zone, ALTER COLUMN "window_end" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_owners" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_resources" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_services" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_component_monitors" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_component_subscriptions" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_components" ALTER COLUMN "start_date" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone, ALTER COLUMN "last_reconciled_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_incident_subscriptions" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_metrics" ALTER COLUMN "date" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "status_page_notification_deliveries_retention_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_notification_deliveries" ALTER COLUMN "leased_until" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone, ALTER COLUMN "enqueued_at" TYPE timestamp with time zone;
--> statement-breakpoint
CREATE INDEX status_page_notification_deliveries_retention_idx ON status_page_notification_deliveries(updated_at) WHERE status IN ('delivered', 'failed', 'skipped');
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_notification_events" ALTER COLUMN "expanded_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_subscribers" ALTER COLUMN "quarantined_at" TYPE timestamp with time zone, ALTER COLUMN "purge_at" TYPE timestamp with time zone, ALTER COLUMN "verified_at" TYPE timestamp with time zone, ALTER COLUMN "webhook_last_attempt_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone, ALTER COLUMN "webhook_verification_expires_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_pages" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone, ALTER COLUMN "custom_domain_last_checked_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "tags" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "test_requirements" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "test_tags" ALTER COLUMN "assigned_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "tests" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "usage_events" ALTER COLUMN "last_sync_attempt" TYPE timestamp with time zone, ALTER COLUMN "billing_period_start" TYPE timestamp with time zone, ALTER COLUMN "billing_period_end" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "usage_notifications" ALTER COLUMN "billing_period_start" TYPE timestamp with time zone, ALTER COLUMN "billing_period_end" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "sent_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "user" ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone, ALTER COLUMN "ban_expires" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "verification" ALTER COLUMN "expires_at" TYPE timestamp with time zone, ALTER COLUMN "created_at" TYPE timestamp with time zone, ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "webhook_idempotency" ALTER COLUMN "processed_at" TYPE timestamp with time zone, ALTER COLUMN "expires_at" TYPE timestamp with time zone;
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
