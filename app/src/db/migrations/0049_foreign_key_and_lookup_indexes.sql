-- Index every foreign key column (so parent deletes and joins stop scanning), add composite
-- indexes for the hot read paths (status pages, run lists, alert history, notifications,
-- evidence), and drop indexes that are fully covered by another index on the same table.
--
-- NOT CONCURRENTLY: the migration runner uses one transaction, so writes to every table indexed
-- here wait until the whole migration commits, and the DROP INDEX statements at the end need a
-- brief exclusive lock (fail after 5s rather than queue). Deploy in a quiet window.
-- Composite DESC columns are NULLS FIRST to match `ORDER BY col DESC` in the queries.
-- Largest tables touched:
--   runs, k6_performance_runs, alert_history, notifications, sre_evidence_items,
--   sre_alert_events, sre_investigation_runs,
--   sre_chat_messages, sre_incident_timeline_events, reports, session.
--
-- Deliberately not indexed (append-only, high write rate, parent effectively never deleted):
--   audit_logs.user_id, sre_incident_timeline_events.actor_user_id
-- runs.triggered_by_user_id, external_connectors.private_agent_id and
-- sre_investigation_tool_calls.investigation_run_id already have partial IS NOT NULL indexes that serve the FK.
-- Re-runnable (CREATE INDEX is rewritten to IF NOT EXISTS by the runner). Forward-only.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '10min';
--> statement-breakpoint
CREATE INDEX "alert_history_monitor_sent_idx" ON "alert_history" ("monitor_id", "sent_at" DESC);
--> statement-breakpoint
CREATE INDEX "alerts_monitor_id_idx" ON "alerts" ("monitor_id");
--> statement-breakpoint
CREATE INDEX "alerts_organization_id_idx" ON "alerts" ("organization_id");
--> statement-breakpoint
CREATE INDEX "device_authorizations_api_key_id_idx" ON "device_authorizations" ("api_key_id");
--> statement-breakpoint
CREATE INDEX "device_authorizations_approved_project_id_idx" ON "device_authorizations" ("approved_project_id");
--> statement-breakpoint
CREATE INDEX "device_authorizations_approved_user_id_idx" ON "device_authorizations" ("approved_user_id");
--> statement-breakpoint
CREATE INDEX "diagnostic_queries_approved_by_user_id_idx" ON "diagnostic_queries" ("approved_by_user_id");
--> statement-breakpoint
CREATE INDEX "diagnostic_queries_connector_id_idx" ON "diagnostic_queries" ("connector_id");
--> statement-breakpoint
CREATE INDEX "diagnostic_queries_created_by_user_id_idx" ON "diagnostic_queries" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "execution_reservations_organization_id_idx" ON "execution_reservations" ("organization_id");
--> statement-breakpoint
CREATE INDEX "external_connector_services_service_id_idx" ON "external_connector_services" ("service_id");
--> statement-breakpoint
CREATE INDEX "external_connectors_created_by_user_id_idx" ON "external_connectors" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "external_connectors_validated_by_private_agent_id_idx" ON "external_connectors" ("validated_by_private_agent_id");
--> statement-breakpoint
CREATE INDEX "incident_components_incident_id_idx" ON "incident_components" ("incident_id");
--> statement-breakpoint
CREATE INDEX "incident_template_components_component_id_idx" ON "incident_template_components" ("component_id");
--> statement-breakpoint
CREATE INDEX "incident_template_components_template_id_idx" ON "incident_template_components" ("template_id");
--> statement-breakpoint
CREATE INDEX "incident_templates_created_by_user_id_idx" ON "incident_templates" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "incident_templates_status_page_id_idx" ON "incident_templates" ("status_page_id");
--> statement-breakpoint
CREATE INDEX "incident_updates_created_by_user_id_idx" ON "incident_updates" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "incident_updates_incident_id_idx" ON "incident_updates" ("incident_id");
--> statement-breakpoint
CREATE INDEX "incidents_created_by_user_id_idx" ON "incidents" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "incidents_status_page_created_idx" ON "incidents" ("status_page_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "invitation_inviter_id_idx" ON "invitation" ("inviter_id");
--> statement-breakpoint
CREATE INDEX "job_notification_settings_notification_provider_id_idx" ON "job_notification_settings" ("notification_provider_id");
--> statement-breakpoint
CREATE INDEX "job_tests_test_case_id_idx" ON "job_tests" ("test_case_id");
--> statement-breakpoint
CREATE INDEX "jobs_created_by_user_id_idx" ON "jobs" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "k6_performance_runs_job_id_idx" ON "k6_performance_runs" ("job_id");
--> statement-breakpoint
CREATE INDEX "k6_performance_runs_organization_id_idx" ON "k6_performance_runs" ("organization_id");
--> statement-breakpoint
CREATE INDEX "k6_runs_project_started_idx" ON "k6_performance_runs" ("project_id", "started_at" DESC);
--> statement-breakpoint
CREATE INDEX "monitor_notification_settings_notification_provider_id_idx" ON "monitor_notification_settings" ("notification_provider_id");
--> statement-breakpoint
CREATE INDEX "monitor_tags_tag_id_idx" ON "monitor_tags" ("tag_id");
--> statement-breakpoint
CREATE INDEX "monitors_created_by_user_id_idx" ON "monitors" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "monitors_organization_id_idx" ON "monitors" ("organization_id");
--> statement-breakpoint
CREATE INDEX "notification_providers_created_by_user_id_idx" ON "notification_providers" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "notification_providers_organization_id_idx" ON "notification_providers" ("organization_id");
--> statement-breakpoint
CREATE INDEX "notification_providers_project_id_idx" ON "notification_providers" ("project_id");
--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "organization_polar_customer_id_idx" ON "organization" ("polar_customer_id") WHERE polar_customer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "organization_subscription_id_idx" ON "organization" ("subscription_id") WHERE subscription_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "postmortems_created_by_user_id_idx" ON "postmortems" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "private_agent_artifacts_organization_id_idx" ON "private_agent_artifacts" ("organization_id");
--> statement-breakpoint
CREATE INDEX "private_agent_credentials_organization_id_idx" ON "private_agent_credentials" ("organization_id");
--> statement-breakpoint
CREATE INDEX "private_agent_credentials_project_id_idx" ON "private_agent_credentials" ("project_id");
--> statement-breakpoint
CREATE INDEX "private_agent_credentials_revoked_by_user_id_idx" ON "private_agent_credentials" ("revoked_by_user_id");
--> statement-breakpoint
CREATE INDEX "private_agent_heartbeats_project_id_idx" ON "private_agent_heartbeats" ("project_id");
--> statement-breakpoint
CREATE INDEX "private_agent_jobs_authorized_by_user_id_idx" ON "private_agent_jobs" ("authorized_by_user_id");
--> statement-breakpoint
CREATE INDEX "private_agent_jobs_connector_id_idx" ON "private_agent_jobs" ("connector_id");
--> statement-breakpoint
CREATE INDEX "private_agent_jobs_organization_id_idx" ON "private_agent_jobs" ("organization_id");
--> statement-breakpoint
CREATE INDEX "private_agents_created_by_user_id_idx" ON "private_agents" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "project_variables_created_by_user_id_idx" ON "project_variables" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "reports_created_by_user_id_idx" ON "reports" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "reports_organization_id_idx" ON "reports" ("organization_id");
--> statement-breakpoint
CREATE INDEX "requirement_coverage_snapshots_last_failed_test_id_idx" ON "requirement_coverage_snapshots" ("last_failed_test_id");
--> statement-breakpoint
CREATE INDEX "requirement_documents_organization_id_idx" ON "requirement_documents" ("organization_id");
--> statement-breakpoint
CREATE INDEX "requirement_documents_uploaded_by_user_id_idx" ON "requirement_documents" ("uploaded_by_user_id");
--> statement-breakpoint
CREATE INDEX "requirement_tags_tag_id_idx" ON "requirement_tags" ("tag_id");
--> statement-breakpoint
CREATE INDEX "requirements_created_by_user_id_idx" ON "requirements" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "requirements_source_document_id_idx" ON "requirements" ("source_document_id");
--> statement-breakpoint
CREATE INDEX "runs_job_created_idx" ON "runs" ("job_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "session_active_project_id_idx" ON "session" ("active_project_id");
--> statement-breakpoint
CREATE INDEX "sre_ai_suggestions_investigation_run_id_idx" ON "sre_ai_suggestions" ("investigation_run_id");
--> statement-breakpoint
CREATE INDEX "sre_ai_suggestions_organization_id_idx" ON "sre_ai_suggestions" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_ai_suggestions_project_id_idx" ON "sre_ai_suggestions" ("project_id");
--> statement-breakpoint
CREATE INDEX "sre_alert_events_project_id_idx" ON "sre_alert_events" ("project_id");
--> statement-breakpoint
CREATE INDEX "sre_background_agent_runs_investigation_run_id_idx" ON "sre_background_agent_runs" ("investigation_run_id");
--> statement-breakpoint
CREATE INDEX "sre_background_agent_runs_organization_id_idx" ON "sre_background_agent_runs" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_background_agent_runs_project_id_idx" ON "sre_background_agent_runs" ("project_id");
--> statement-breakpoint
CREATE INDEX "sre_chat_conversations_organization_id_idx" ON "sre_chat_conversations" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_chat_messages_investigation_run_id_idx" ON "sre_chat_messages" ("investigation_run_id");
--> statement-breakpoint
CREATE INDEX "sre_chat_messages_tool_call_id_idx" ON "sre_chat_messages" ("tool_call_id");
--> statement-breakpoint
CREATE INDEX "sre_context_observations_organization_id_idx" ON "sre_context_observations" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_context_playbooks_created_by_user_id_idx" ON "sre_context_playbooks" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "sre_context_playbooks_promoted_from_recollection_id_idx" ON "sre_context_playbooks" ("promoted_from_recollection_id");
--> statement-breakpoint
CREATE INDEX "sre_context_recollections_organization_id_idx" ON "sre_context_recollections" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_context_recollections_project_id_idx" ON "sre_context_recollections" ("project_id");
--> statement-breakpoint
CREATE INDEX "sre_evidence_graph_focused_views_organization_id_idx" ON "sre_evidence_graph_focused_views" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_evidence_items_organization_id_idx" ON "sre_evidence_items" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_evidence_items_project_created_idx" ON "sre_evidence_items" ("project_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "sre_evidence_items_source_connector_id_idx" ON "sre_evidence_items" ("source_connector_id");
--> statement-breakpoint
CREATE INDEX "sre_incident_runbook_steps_completed_by_idx" ON "sre_incident_runbook_steps" ("completed_by");
--> statement-breakpoint
CREATE INDEX "sre_incident_runbook_steps_runbook_id_idx" ON "sre_incident_runbook_steps" ("runbook_id");
--> statement-breakpoint
CREATE INDEX "sre_incident_runbook_steps_runbook_step_id_idx" ON "sre_incident_runbook_steps" ("runbook_step_id");
--> statement-breakpoint
CREATE INDEX "sre_incident_timeline_events_agent_run_id_idx" ON "sre_incident_timeline_events" ("agent_run_id");
--> statement-breakpoint
CREATE INDEX "sre_incident_timeline_events_evidence_item_id_idx" ON "sre_incident_timeline_events" ("evidence_item_id");
--> statement-breakpoint
CREATE INDEX "sre_incidents_acknowledged_by_user_id_idx" ON "sre_incidents" ("acknowledged_by_user_id");
--> statement-breakpoint
CREATE INDEX "sre_incidents_assignee_user_id_idx" ON "sre_incidents" ("assignee_user_id");
--> statement-breakpoint
CREATE INDEX "sre_incidents_commander_user_id_idx" ON "sre_incidents" ("commander_user_id");
--> statement-breakpoint
CREATE INDEX "sre_incidents_created_by_user_id_idx" ON "sre_incidents" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "sre_incidents_status_page_incident_id_idx" ON "sre_incidents" ("status_page_incident_id");
--> statement-breakpoint
CREATE INDEX "sre_integration_binding_services_service_id_idx" ON "sre_integration_binding_services" ("service_id");
--> statement-breakpoint
CREATE INDEX "sre_integration_bindings_created_by_user_id_idx" ON "sre_integration_bindings" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "sre_integration_bindings_organization_id_idx" ON "sre_integration_bindings" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_feedback_organization_id_idx" ON "sre_investigation_feedback" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_feedback_user_id_idx" ON "sre_investigation_feedback" ("user_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_recommendations_investigation_run_id_idx" ON "sre_investigation_recommendations" ("investigation_run_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_report_feedback_created_by_user_id_idx" ON "sre_investigation_report_feedback" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_report_feedback_incident_id_idx" ON "sre_investigation_report_feedback" ("incident_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_report_feedback_organization_id_idx" ON "sre_investigation_report_feedback" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_reports_created_by_user_id_idx" ON "sre_investigation_reports" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_reports_organization_id_idx" ON "sre_investigation_reports" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_runs_alert_event_id_idx" ON "sre_investigation_runs" ("alert_event_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_runs_created_by_user_id_idx" ON "sre_investigation_runs" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_runs_organization_id_idx" ON "sre_investigation_runs" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_tool_calls_connector_id_idx" ON "sre_investigation_tool_calls" ("connector_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_tool_calls_evidence_item_id_idx" ON "sre_investigation_tool_calls" ("evidence_item_id");
--> statement-breakpoint
CREATE INDEX "sre_runbooks_created_by_user_id_idx" ON "sre_runbooks" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "sre_runbooks_service_id_idx" ON "sre_runbooks" ("service_id");
--> statement-breakpoint
CREATE INDEX "sre_service_dependencies_approved_by_idx" ON "sre_service_dependencies" ("approved_by");
--> statement-breakpoint
CREATE INDEX "sre_service_dependencies_organization_id_idx" ON "sre_service_dependencies" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_service_dependencies_source_service_id_idx" ON "sre_service_dependencies" ("source_service_id");
--> statement-breakpoint
CREATE INDEX "sre_service_dependency_observations_target_service_id_idx" ON "sre_service_dependency_observations" ("target_service_id");
--> statement-breakpoint
CREATE INDEX "sre_service_discovery_suggestions_approved_by_idx" ON "sre_service_discovery_suggestions" ("approved_by");
--> statement-breakpoint
CREATE INDEX "sre_service_discovery_suggestions_project_id_idx" ON "sre_service_discovery_suggestions" ("project_id");
--> statement-breakpoint
CREATE INDEX "sre_services_organization_id_idx" ON "sre_services" ("organization_id");
--> statement-breakpoint
CREATE INDEX "sre_services_owner_user_id_idx" ON "sre_services" ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "status_page_component_monitors_monitor_id_idx" ON "status_page_component_monitors" ("monitor_id");
--> statement-breakpoint
CREATE INDEX "status_page_component_subscriptions_component_id_idx" ON "status_page_component_subscriptions" ("component_id");
--> statement-breakpoint
CREATE INDEX "status_page_components_status_page_id_idx" ON "status_page_components" ("status_page_id");
--> statement-breakpoint
CREATE INDEX "status_page_incident_subscriptions_incident_id_idx" ON "status_page_incident_subscriptions" ("incident_id");
--> statement-breakpoint
CREATE INDEX "status_page_metrics_component_id_idx" ON "status_page_metrics" ("component_id");
--> statement-breakpoint
CREATE INDEX "status_page_subscribers_active_idx" ON "status_page_subscribers" ("status_page_id") WHERE purge_at IS NULL;
--> statement-breakpoint
CREATE INDEX "status_page_subscribers_status_page_id_idx" ON "status_page_subscribers" ("status_page_id");
--> statement-breakpoint
CREATE INDEX "status_pages_created_by_user_id_idx" ON "status_pages" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "status_pages_org_project_idx" ON "status_pages" ("organization_id", "project_id");
--> statement-breakpoint
CREATE INDEX "status_pages_project_id_idx" ON "status_pages" ("project_id");
--> statement-breakpoint
CREATE INDEX "tags_created_by_user_id_idx" ON "tags" ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX "tags_organization_id_idx" ON "tags" ("organization_id");
--> statement-breakpoint
CREATE INDEX "test_tags_tag_id_idx" ON "test_tags" ("tag_id");
--> statement-breakpoint
CREATE INDEX "tests_created_by_user_id_idx" ON "tests" ("created_by_user_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "audit_logs_action_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "apikey_key_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "billing_settings_org_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "invitation_email_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "projects_organization_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "tests_project_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "jobs_project_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "runs_job_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "runs_project_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "monitors_project_org_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "requirement_coverage_snapshots_requirement_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "requirement_documents_project_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "requirements_project_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "test_requirements_test_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "idx_project_locations_project";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "sre_ai_suggestions_incident_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "sre_incident_alerts_incident_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "sre_service_resources_service_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "oauth_client_resource_client_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "oauth_consent_client_id_idx";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX IF EXISTS "alert_history_monitor_id_idx";
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
