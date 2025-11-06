-- ===========================================================================
-- COMPREHENSIVE DATABASE INDEX MIGRATION
-- ===========================================================================
-- This script adds critical indexes for improved query performance and
-- scalability. Indexes are organized by table and query pattern.
--
-- Performance Impact: These indexes will significantly improve:
-- - JOIN operations on foreign keys
-- - Filtered queries on status columns
-- - Sorted/paginated queries on timestamps
-- - Lookup queries on frequently accessed columns
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SESSION TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session(user_id);
CREATE INDEX IF NOT EXISTS session_expires_at_idx ON session(expires_at);
CREATE INDEX IF NOT EXISTS session_active_org_idx ON session(active_organization_id);

-- ---------------------------------------------------------------------------
-- ACCOUNT TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(user_id);
CREATE INDEX IF NOT EXISTS account_provider_account_idx ON account(provider_id, account_id);

-- ---------------------------------------------------------------------------
-- VERIFICATION TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
CREATE INDEX IF NOT EXISTS verification_expires_at_idx ON verification(expires_at);

-- ---------------------------------------------------------------------------
-- APIKEY TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS apikey_key_idx ON apikey(key);
CREATE INDEX IF NOT EXISTS apikey_user_id_idx ON apikey(user_id);
CREATE INDEX IF NOT EXISTS apikey_project_id_idx ON apikey(project_id);
CREATE INDEX IF NOT EXISTS apikey_job_id_idx ON apikey(job_id);
CREATE INDEX IF NOT EXISTS apikey_enabled_idx ON apikey(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS apikey_expires_at_idx ON apikey(expires_at);

-- ---------------------------------------------------------------------------
-- INVITATION TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS invitation_organization_id_idx ON invitation(organization_id);
CREATE INDEX IF NOT EXISTS invitation_email_idx ON invitation(email);
CREATE INDEX IF NOT EXISTS invitation_email_status_idx ON invitation(email, status);
CREATE INDEX IF NOT EXISTS invitation_expires_at_idx ON invitation(expires_at);

-- ---------------------------------------------------------------------------
-- PROJECTS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS projects_organization_id_idx ON projects(organization_id);
CREATE INDEX IF NOT EXISTS projects_org_status_idx ON projects(organization_id, status);
CREATE INDEX IF NOT EXISTS projects_is_default_idx ON projects(is_default);

-- ---------------------------------------------------------------------------
-- JOBS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS jobs_organization_id_idx ON jobs(organization_id);
CREATE INDEX IF NOT EXISTS jobs_project_id_idx ON jobs(project_id);
CREATE INDEX IF NOT EXISTS jobs_project_status_idx ON jobs(project_id, status);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_next_run_at_idx ON jobs(next_run_at);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs(created_at);

-- ---------------------------------------------------------------------------
-- RUNS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS runs_job_id_idx ON runs(job_id);
CREATE INDEX IF NOT EXISTS runs_project_id_idx ON runs(project_id);
CREATE INDEX IF NOT EXISTS runs_job_status_idx ON runs(job_id, status);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);
CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs(created_at);
CREATE INDEX IF NOT EXISTS runs_completed_at_idx ON runs(completed_at);
CREATE INDEX IF NOT EXISTS runs_project_created_at_idx ON runs(project_id, created_at);

-- ---------------------------------------------------------------------------
-- TESTS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS tests_organization_id_idx ON tests(organization_id);
CREATE INDEX IF NOT EXISTS tests_project_id_idx ON tests(project_id);
CREATE INDEX IF NOT EXISTS tests_project_type_idx ON tests(project_id, type);
CREATE INDEX IF NOT EXISTS tests_type_idx ON tests(type);
CREATE INDEX IF NOT EXISTS tests_created_at_idx ON tests(created_at);

-- ---------------------------------------------------------------------------
-- MONITORS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS monitors_organization_id_idx ON monitors(organization_id);
CREATE INDEX IF NOT EXISTS monitors_project_id_idx ON monitors(project_id);
CREATE INDEX IF NOT EXISTS monitors_project_enabled_idx ON monitors(project_id, enabled);
CREATE INDEX IF NOT EXISTS monitors_status_idx ON monitors(status);
CREATE INDEX IF NOT EXISTS monitors_enabled_idx ON monitors(enabled);
CREATE INDEX IF NOT EXISTS monitors_last_check_at_idx ON monitors(last_check_at);
CREATE INDEX IF NOT EXISTS monitors_created_at_idx ON monitors(created_at);

-- ---------------------------------------------------------------------------
-- MONITOR_RESULTS TABLE INDEXES
-- ---------------------------------------------------------------------------
-- Note: monitor_results_monitor_location_checked_idx already exists
CREATE INDEX IF NOT EXISTS monitor_results_monitor_id_idx ON monitor_results(monitor_id);
CREATE INDEX IF NOT EXISTS monitor_results_checked_at_idx ON monitor_results(checked_at);
CREATE INDEX IF NOT EXISTS monitor_results_is_status_change_idx ON monitor_results(is_status_change);

-- ---------------------------------------------------------------------------
-- K6_PERFORMANCE_RUNS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS k6_perf_runs_run_id_idx ON k6_performance_runs(run_id);
CREATE INDEX IF NOT EXISTS k6_perf_runs_job_id_idx ON k6_performance_runs(job_id);
CREATE INDEX IF NOT EXISTS k6_perf_runs_project_id_idx ON k6_performance_runs(project_id);
CREATE INDEX IF NOT EXISTS k6_perf_runs_organization_id_idx ON k6_performance_runs(organization_id);
CREATE INDEX IF NOT EXISTS k6_perf_runs_status_idx ON k6_performance_runs(status);
CREATE INDEX IF NOT EXISTS k6_perf_runs_created_at_idx ON k6_performance_runs(created_at);

-- ---------------------------------------------------------------------------
-- NOTIFICATION_PROVIDERS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS notification_providers_organization_id_idx ON notification_providers(organization_id);
CREATE INDEX IF NOT EXISTS notification_providers_project_id_idx ON notification_providers(project_id);
CREATE INDEX IF NOT EXISTS notification_providers_is_enabled_idx ON notification_providers(is_enabled);

-- ---------------------------------------------------------------------------
-- ALERT_HISTORY TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS alert_history_monitor_id_idx ON alert_history(monitor_id);
CREATE INDEX IF NOT EXISTS alert_history_job_id_idx ON alert_history(job_id);
CREATE INDEX IF NOT EXISTS alert_history_status_idx ON alert_history(status);
CREATE INDEX IF NOT EXISTS alert_history_sent_at_idx ON alert_history(sent_at);

-- ---------------------------------------------------------------------------
-- ALERTS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS alerts_organization_id_idx ON alerts(organization_id);
CREATE INDEX IF NOT EXISTS alerts_monitor_id_idx ON alerts(monitor_id);
CREATE INDEX IF NOT EXISTS alerts_enabled_idx ON alerts(enabled);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_status_idx ON notifications(status);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at);

-- ---------------------------------------------------------------------------
-- STATUS_PAGES TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS status_pages_organization_id_idx ON status_pages(organization_id);
CREATE INDEX IF NOT EXISTS status_pages_project_id_idx ON status_pages(project_id);
CREATE INDEX IF NOT EXISTS status_pages_status_idx ON status_pages(status);

-- ---------------------------------------------------------------------------
-- STATUS_PAGE_COMPONENTS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS status_page_components_status_page_id_idx ON status_page_components(status_page_id);
CREATE INDEX IF NOT EXISTS status_page_components_status_idx ON status_page_components(status);

-- ---------------------------------------------------------------------------
-- INCIDENTS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS incidents_status_page_id_idx ON incidents(status_page_id);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents(status);
CREATE INDEX IF NOT EXISTS incidents_created_at_idx ON incidents(created_at);
CREATE INDEX IF NOT EXISTS incidents_resolved_at_idx ON incidents(resolved_at);

-- ---------------------------------------------------------------------------
-- INCIDENT_UPDATES TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS incident_updates_incident_id_idx ON incident_updates(incident_id);
CREATE INDEX IF NOT EXISTS incident_updates_created_at_idx ON incident_updates(created_at);

-- ---------------------------------------------------------------------------
-- INCIDENT_COMPONENTS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS incident_components_incident_id_idx ON incident_components(incident_id);
CREATE INDEX IF NOT EXISTS incident_components_component_id_idx ON incident_components(component_id);

-- ---------------------------------------------------------------------------
-- STATUS_PAGE_SUBSCRIBERS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS status_page_subscribers_status_page_id_idx ON status_page_subscribers(status_page_id);
CREATE INDEX IF NOT EXISTS status_page_subscribers_email_idx ON status_page_subscribers(email);
CREATE INDEX IF NOT EXISTS status_page_subscribers_verified_at_idx ON status_page_subscribers(verified_at);

-- ---------------------------------------------------------------------------
-- INCIDENT_TEMPLATES TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS incident_templates_status_page_id_idx ON incident_templates(status_page_id);

-- ---------------------------------------------------------------------------
-- AUDIT_LOGS TABLE INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_organization_id_idx ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);

-- ---------------------------------------------------------------------------
-- REPORTS TABLE INDEXES
-- ---------------------------------------------------------------------------
-- Note: reports_entity_type_id_idx already exists
CREATE INDEX IF NOT EXISTS reports_organization_id_idx ON reports(organization_id);
CREATE INDEX IF NOT EXISTS reports_created_at_idx ON reports(created_at);

-- ===========================================================================
-- VERIFICATION QUERIES
-- ===========================================================================
-- Run these queries after migration to verify index creation:
--
-- SELECT schemaname, tablename, indexname
-- FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;
--
-- -- Check index usage:
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public'
-- ORDER BY idx_scan DESC;
-- ===========================================================================
