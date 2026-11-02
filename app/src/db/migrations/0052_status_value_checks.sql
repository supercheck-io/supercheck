-- Restrict status, type and other enum-like text columns to the values the application can write.
-- Each CHECK is added NOT VALID only (a metadata-only change, so every new write is enforced
-- immediately) and is validated after the migration commits by scripts/db-migrate.js; a column that
-- already holds an unexpected value stays NOT VALID and logs a warning instead of failing the deploy.
-- The allowed values are the union of the application and worker schema types and every value the
-- code writes. Columns whose values come from providers or free-form input are intentionally not
-- constrained. Re-runnable. Forward-only.
-- Fail fast instead of queueing behind a long transaction and blocking sign-ins.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '10min';
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_job_type_check";
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_job_type_check" CHECK ("job_type" IN ('playwright', 'k6')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_status_check";
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_status_check" CHECK ("status" IN ('pending', 'running', 'passed', 'failed', 'error')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "runs_status_check";
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_status_check" CHECK ("status" IN ('running', 'passed', 'failed', 'error', 'blocked', 'queued')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "runs_trigger_check";
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_trigger_check" CHECK ("trigger" IN ('manual', 'remote', 'schedule')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "k6_performance_runs" DROP CONSTRAINT IF EXISTS "k6_performance_runs_status_check";
--> statement-breakpoint
ALTER TABLE "k6_performance_runs" ADD CONSTRAINT "k6_performance_runs_status_check" CHECK ("status" IN ('running', 'passed', 'failed', 'error', 'blocked', 'queued')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitor_aggregates" DROP CONSTRAINT IF EXISTS "monitor_aggregates_period_type_check";
--> statement-breakpoint
ALTER TABLE "monitor_aggregates" ADD CONSTRAINT "monitor_aggregates_period_type_check" CHECK ("period_type" IN ('hourly', 'daily')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitors" DROP CONSTRAINT IF EXISTS "monitors_type_check";
--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_type_check" CHECK ("type" IN ('http_request', 'website', 'ping_host', 'port_check', 'synthetic_test')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitors" DROP CONSTRAINT IF EXISTS "monitors_status_check";
--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_status_check" CHECK ("status" IN ('up', 'down', 'paused', 'pending', 'maintenance', 'error')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitor_results" DROP CONSTRAINT IF EXISTS "monitor_results_status_check";
--> statement-breakpoint
ALTER TABLE "monitor_results" ADD CONSTRAINT "monitor_results_status_check" CHECK ("status" IN ('up', 'down', 'error', 'timeout')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "notification_providers" DROP CONSTRAINT IF EXISTS "notification_providers_type_check";
--> statement-breakpoint
ALTER TABLE "notification_providers" ADD CONSTRAINT "notification_providers_type_check" CHECK ("type" IN ('email', 'slack', 'webhook', 'telegram', 'discord', 'teams')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "alert_history" DROP CONSTRAINT IF EXISTS "alert_history_type_check";
--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_type_check" CHECK ("type" IN ('monitor_failure', 'monitor_recovery', 'job_failed', 'job_success', 'job_timeout', 'ssl_expiring')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "alert_history" DROP CONSTRAINT IF EXISTS "alert_history_status_check";
--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_status_check" CHECK ("status" IN ('sent', 'failed', 'pending')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_subscription_plan_check";
--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_subscription_plan_check" CHECK ("subscription_plan" IS NULL OR "subscription_plan" IN ('plus', 'pro', 'unlimited')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_subscription_status_check";
--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_subscription_status_check" CHECK ("subscription_status" IS NULL OR "subscription_status" IN ('active', 'canceled', 'past_due', 'none')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_status_check";
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_check" CHECK ("status" IN ('active', 'archived', 'deleted')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "project_variables" DROP CONSTRAINT IF EXISTS "project_variables_type_check";
--> statement-breakpoint
ALTER TABLE "project_variables" ADD CONSTRAINT "project_variables_type_check" CHECK ("type" IN ('variable', 'secret', 'file')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "plan_limits" DROP CONSTRAINT IF EXISTS "plan_limits_plan_check";
--> statement-breakpoint
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_plan_check" CHECK ("plan" IN ('plus', 'pro', 'unlimited')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "overage_pricing" DROP CONSTRAINT IF EXISTS "overage_pricing_plan_check";
--> statement-breakpoint
ALTER TABLE "overage_pricing" ADD CONSTRAINT "overage_pricing_plan_check" CHECK ("plan" IN ('plus', 'pro')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_entity_type_check";
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_entity_type_check" CHECK ("entity_type" IN ('test', 'job', 'monitor', 'k6_test', 'k6_job')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "tests" DROP CONSTRAINT IF EXISTS "tests_type_check";
--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_type_check" CHECK ("type" IN ('browser', 'api', 'database', 'custom', 'performance')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "tests" DROP CONSTRAINT IF EXISTS "tests_priority_check";
--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_priority_check" CHECK ("priority" IN ('low', 'medium', 'high')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "usage_events" DROP CONSTRAINT IF EXISTS "usage_events_event_type_check";
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_event_type_check" CHECK ("event_type" IN ('playwright_execution', 'k6_execution', 'monitor_execution', 'ai_usage', 'sre_investigation')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "usage_notifications" DROP CONSTRAINT IF EXISTS "usage_notifications_notification_type_check";
--> statement-breakpoint
ALTER TABLE "usage_notifications" ADD CONSTRAINT "usage_notifications_notification_type_check" CHECK ("notification_type" IN ('usage_50_percent', 'usage_80_percent', 'usage_90_percent', 'usage_100_percent', 'spending_limit_warning', 'spending_limit_reached', 'billing_period_reset')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "usage_notifications" DROP CONSTRAINT IF EXISTS "usage_notifications_resource_type_check";
--> statement-breakpoint
ALTER TABLE "usage_notifications" ADD CONSTRAINT "usage_notifications_resource_type_check" CHECK ("resource_type" IN ('playwright', 'k6', 'ai', 'sre', 'combined', 'spending')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "usage_notifications" DROP CONSTRAINT IF EXISTS "usage_notifications_delivery_status_check";
--> statement-breakpoint
ALTER TABLE "usage_notifications" ADD CONSTRAINT "usage_notifications_delivery_status_check" CHECK ("delivery_status" IN ('pending', 'sent', 'failed')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_pages" DROP CONSTRAINT IF EXISTS "status_pages_status_check";
--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_status_check" CHECK ("status" IN ('draft', 'published', 'archived')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_components" DROP CONSTRAINT IF EXISTS "status_page_components_status_check";
--> statement-breakpoint
ALTER TABLE "status_page_components" ADD CONSTRAINT "status_page_components_status_check" CHECK ("status" IN ('operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incidents" DROP CONSTRAINT IF EXISTS "incidents_status_check";
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_status_check" CHECK ("status" IN ('investigating', 'identified', 'monitoring', 'resolved', 'scheduled')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incidents" DROP CONSTRAINT IF EXISTS "incidents_impact_check";
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_impact_check" CHECK ("impact" IN ('none', 'minor', 'major', 'critical')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incident_updates" DROP CONSTRAINT IF EXISTS "incident_updates_status_check";
--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_status_check" CHECK ("status" IN ('investigating', 'identified', 'monitoring', 'resolved', 'scheduled')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_subscribers" DROP CONSTRAINT IF EXISTS "status_page_subscribers_mode_check";
--> statement-breakpoint
ALTER TABLE "status_page_subscribers" ADD CONSTRAINT "status_page_subscribers_mode_check" CHECK ("mode" IN ('email', 'webhook', 'slack')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_services" DROP CONSTRAINT IF EXISTS "sre_services_status_check";
--> statement-breakpoint
ALTER TABLE "sre_services" ADD CONSTRAINT "sre_services_status_check" CHECK ("status" IN ('active', 'deprecated', 'merged')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_services" DROP CONSTRAINT IF EXISTS "sre_services_tier_check";
--> statement-breakpoint
ALTER TABLE "sre_services" ADD CONSTRAINT "sre_services_tier_check" CHECK ("tier" IN ('1', '2', '3', '4')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_owners" DROP CONSTRAINT IF EXISTS "sre_service_owners_owner_type_check";
--> statement-breakpoint
ALTER TABLE "sre_service_owners" ADD CONSTRAINT "sre_service_owners_owner_type_check" CHECK ("owner_type" IN ('team', 'user', 'slack')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_owners" DROP CONSTRAINT IF EXISTS "sre_service_owners_role_check";
--> statement-breakpoint
ALTER TABLE "sre_service_owners" ADD CONSTRAINT "sre_service_owners_role_check" CHECK ("role" IN ('primary', 'on-call', 'secondary', 'reviewer')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_resources" DROP CONSTRAINT IF EXISTS "sre_service_resources_resource_type_check";
--> statement-breakpoint
ALTER TABLE "sre_service_resources" ADD CONSTRAINT "sre_service_resources_resource_type_check" CHECK ("resource_type" IN ('monitor', 'job', 'test', 'status_page_component', 'k6_run')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_resources" DROP CONSTRAINT IF EXISTS "sre_service_resources_relationship_check";
--> statement-breakpoint
ALTER TABLE "sre_service_resources" ADD CONSTRAINT "sre_service_resources_relationship_check" CHECK ("relationship" IN ('monitors', 'owned', 'depends_on')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_dependencies" DROP CONSTRAINT IF EXISTS "sre_service_dependencies_status_check";
--> statement-breakpoint
ALTER TABLE "sre_service_dependencies" ADD CONSTRAINT "sre_service_dependencies_status_check" CHECK ("status" IN ('active', 'stale', 'rejected')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_alert_events" DROP CONSTRAINT IF EXISTS "sre_alert_events_severity_check";
--> statement-breakpoint
ALTER TABLE "sre_alert_events" ADD CONSTRAINT "sre_alert_events_severity_check" CHECK ("severity" IN ('sev1', 'sev2', 'sev3', 'sev4')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_alert_events" DROP CONSTRAINT IF EXISTS "sre_alert_events_status_check";
--> statement-breakpoint
ALTER TABLE "sre_alert_events" ADD CONSTRAINT "sre_alert_events_status_check" CHECK ("status" IN ('firing', 'resolved', 'silenced', 'deduplicated')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_incidents" DROP CONSTRAINT IF EXISTS "sre_incidents_severity_check";
--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD CONSTRAINT "sre_incidents_severity_check" CHECK ("severity" IN ('sev1', 'sev2', 'sev3', 'sev4')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_incidents" DROP CONSTRAINT IF EXISTS "sre_incidents_status_check";
--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD CONSTRAINT "sre_incidents_status_check" CHECK ("status" IN ('triggered', 'investigating', 'identified', 'recommendations_ready', 'user_applying_fix', 'verifying', 'resolved')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_incident_alerts" DROP CONSTRAINT IF EXISTS "sre_incident_alerts_role_check";
--> statement-breakpoint
ALTER TABLE "sre_incident_alerts" ADD CONSTRAINT "sre_incident_alerts_role_check" CHECK ("role" IN ('trigger', 'related', 'red_herring')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_investigation_runs" DROP CONSTRAINT IF EXISTS "sre_investigation_runs_status_check";
--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD CONSTRAINT "sre_investigation_runs_status_check" CHECK ("status" IN ('running', 'completed', 'failed', 'aborted', 'timed_out')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_investigation_tool_calls" DROP CONSTRAINT IF EXISTS "sre_investigation_tool_calls_status_check";
--> statement-breakpoint
ALTER TABLE "sre_investigation_tool_calls" ADD CONSTRAINT "sre_investigation_tool_calls_status_check" CHECK ("status" IN ('success', 'error', 'timeout', 'aborted')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "private_agents" DROP CONSTRAINT IF EXISTS "private_agents_status_check";
--> statement-breakpoint
ALTER TABLE "private_agents" ADD CONSTRAINT "private_agents_status_check" CHECK ("status" IN ('pending', 'connected', 'disconnected', 'unhealthy', 'disabled')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "private_agents" DROP CONSTRAINT IF EXISTS "private_agents_agent_mode_check";
--> statement-breakpoint
ALTER TABLE "private_agents" ADD CONSTRAINT "private_agents_agent_mode_check" CHECK ("agent_mode" IN ('connector_proxy', 'execution_worker', 'hybrid')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "private_agent_jobs" DROP CONSTRAINT IF EXISTS "private_agent_jobs_status_check";
--> statement-breakpoint
ALTER TABLE "private_agent_jobs" ADD CONSTRAINT "private_agent_jobs_status_check" CHECK ("status" IN ('queued', 'leased', 'running', 'completed', 'failed', 'cancelled', 'timed_out')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "private_agent_jobs" DROP CONSTRAINT IF EXISTS "private_agent_jobs_job_class_check";
--> statement-breakpoint
ALTER TABLE "private_agent_jobs" ADD CONSTRAINT "private_agent_jobs_job_class_check" CHECK ("job_class" IN ('sre_connector_query', 'http_monitor_check', 'playwright_run', 'k6_run', 'network_check')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "external_connectors" DROP CONSTRAINT IF EXISTS "external_connectors_status_check";
--> statement-breakpoint
ALTER TABLE "external_connectors" ADD CONSTRAINT "external_connectors_status_check" CHECK ("status" IN ('configured', 'valid', 'unreachable', 'missing_credentials', 'disabled')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "external_connectors" DROP CONSTRAINT IF EXISTS "external_connectors_risk_level_check";
--> statement-breakpoint
ALTER TABLE "external_connectors" ADD CONSTRAINT "external_connectors_risk_level_check" CHECK ("risk_level" IN ('low', 'medium', 'high', 'critical')) NOT VALID;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "invitation" DROP CONSTRAINT IF EXISTS "invitation_status_check";
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_status_check" CHECK ("status" IN ('pending', 'accepted', 'rejected', 'canceled', 'cancelled', 'expired')) NOT VALID;
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
