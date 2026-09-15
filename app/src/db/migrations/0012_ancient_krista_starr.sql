CREATE TABLE "diagnostic_queries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"query_type" varchar(30) NOT NULL,
	"template" text NOT NULL,
	"parameter_schema" jsonb NOT NULL,
	"allowlist" jsonb NOT NULL,
	"max_rows" integer DEFAULT 100 NOT NULL,
	"max_bytes" integer DEFAULT 1048576 NOT NULL,
	"max_seconds" integer DEFAULT 10 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_connector_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connector_id" uuid NOT NULL,
	"credential_type" varchar(20) NOT NULL,
	"encrypted_credential" text NOT NULL,
	"encryption_version" integer DEFAULT 1 NOT NULL,
	"encryption_key_context" varchar(255),
	"expires_at" timestamp,
	"last_rotated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_connector_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_connectors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"private_agent_id" uuid,
	"name" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"risk_level" varchar(10) DEFAULT 'low' NOT NULL,
	"permission_level" varchar(10) DEFAULT 'read' NOT NULL,
	"side_effect_level" varchar(10) DEFAULT 'none' NOT NULL,
	"status" varchar(20) DEFAULT 'configured' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"default_time_window_minutes" integer DEFAULT 60 NOT NULL,
	"output_limits" jsonb,
	"last_validated_at" timestamp,
	"last_validation_status" varchar(20),
	"last_validation_error" text,
	"last_validation_latency_ms" integer,
	"validated_by_private_agent_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_connectors_permission_level_read_check" CHECK ("external_connectors"."permission_level" = 'read'),
	CONSTRAINT "external_connectors_side_effect_level_none_check" CHECK ("external_connectors"."side_effect_level" = 'none')
);
--> statement-breakpoint
CREATE TABLE "private_agent_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"private_agent_job_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"artifact_type" varchar(30) NOT NULL,
	"s3_path" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content_type" varchar(100),
	"size_bytes" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_agent_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"private_agent_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"key_id" varchar(100) NOT NULL,
	"secret_hash" text NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"rotated_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by_user_id" uuid,
	"revocation_reason" text
);
--> statement-breakpoint
CREATE TABLE "private_agent_heartbeats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"private_agent_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"status" varchar(20) NOT NULL,
	"protocol_version" varchar(30) NOT NULL,
	"agent_version" varchar(50) NOT NULL,
	"active_job_count" integer DEFAULT 0 NOT NULL,
	"reported_capabilities" jsonb DEFAULT '{}'::jsonb,
	"latency_ms" integer,
	"error_code" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_agent_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"private_agent_id" uuid NOT NULL,
	"connector_id" uuid,
	"job_class" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"authorized_by" varchar(30) NOT NULL,
	"authorized_by_user_id" uuid,
	"policy_decision_hash" varchar(128) NOT NULL,
	"job_spec_hash" varchar(128) NOT NULL,
	"lease_token_hash" varchar(128),
	"lease_expires_at" timestamp,
	"idempotency_key" varchar(128) NOT NULL,
	"cancel_requested_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_ms" integer,
	"error_code" varchar(100),
	"result_hash" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"name" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"version" varchar(50),
	"registration_token_hash" text,
	"agent_mode" varchar(20) DEFAULT 'connector_proxy' NOT NULL,
	"supports_sre_connectors" boolean DEFAULT true NOT NULL,
	"supports_http_monitoring" boolean DEFAULT false NOT NULL,
	"supports_playwright" boolean DEFAULT false NOT NULL,
	"supports_k6" boolean DEFAULT false NOT NULL,
	"supports_network_checks" boolean DEFAULT false NOT NULL,
	"region" varchar(50),
	"network_label" varchar(100),
	"last_heartbeat_at" timestamp,
	"connected_at" timestamp,
	"registered_at" timestamp,
	"disabled_at" timestamp,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_ai_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"incident_id" uuid,
	"investigation_run_id" uuid,
	"suggestion_type" varchar(30) NOT NULL,
	"content" text NOT NULL,
	"model_id" varchar(100) NOT NULL,
	"confidence_score" numeric(5, 4),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"prompt_input" jsonb,
	"accepted" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_alert_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"fingerprint_hash" varchar(64) NOT NULL,
	"dedup_key" varchar(255),
	"severity" varchar(10) DEFAULT 'sev3' NOT NULL,
	"status" varchar(15) DEFAULT 'firing' NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_id" uuid,
	"service_id" uuid,
	"title" varchar(500) NOT NULL,
	"description" text,
	"fired_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"silenced_at" timestamp,
	"silence_reason" text,
	"triage_investigation_run_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_background_agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_type" varchar(50) NOT NULL,
	"status" varchar(15) DEFAULT 'scheduled' NOT NULL,
	"schedule_id" varchar(100),
	"trigger_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"result_summary" text,
	"result_data" jsonb,
	"investigation_run_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_chat_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"incident_id" uuid,
	"title" varchar(200),
	"scope" jsonb,
	"status" varchar(15) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(15) NOT NULL,
	"content" text,
	"attachments" jsonb,
	"tool_call_id" uuid,
	"evidence_item_ids" jsonb,
	"investigation_run_id" uuid,
	"model_id" varchar(100),
	"token_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_context_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid,
	"observation_type" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"source" varchar(50) NOT NULL,
	"confidence" numeric(5, 4),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_context_playbooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"promoted_from_recollection_id" uuid,
	"name" varchar(200) NOT NULL,
	"alert_signature_hash" varchar(64) NOT NULL,
	"alert_signature" jsonb NOT NULL,
	"playbook_content" text NOT NULL,
	"match_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(15) DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_context_recollections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"incident_id" uuid,
	"service_id" uuid,
	"error_fingerprint" varchar(64),
	"isolating_query" text,
	"what_was_tried" jsonb,
	"root_cause" text,
	"resolution" text,
	"promoted_to_playbook_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_evidence_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"incident_id" uuid,
	"investigation_run_id" uuid,
	"source_type" varchar(30) NOT NULL,
	"source_connector_id" uuid,
	"source_uri" varchar(1000) NOT NULL,
	"title" varchar(500) NOT NULL,
	"summary" text,
	"raw_content_s3_path" text,
	"raw_content_excerpt" text,
	"evidence_type" varchar(15) NOT NULL,
	"severity" varchar(10),
	"confidence" numeric(5, 4),
	"tags" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"citation_query" text,
	"citation_result_hash" varchar(64),
	"observed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_incident_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"alert_event_id" uuid NOT NULL,
	"role" varchar(20) DEFAULT 'trigger' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_incident_runbook_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"runbook_step_id" uuid,
	"runbook_id" uuid,
	"step_order" integer NOT NULL,
	"instruction" text NOT NULL,
	"status" varchar(15) DEFAULT 'pending' NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_incident_timeline_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"event_type" varchar(25) NOT NULL,
	"event_data" jsonb,
	"actor_type" varchar(10) DEFAULT 'user' NOT NULL,
	"actor_user_id" uuid,
	"agent_run_id" uuid,
	"evidence_item_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_incident_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"resource_type" varchar(20) NOT NULL,
	"resource_id" uuid NOT NULL,
	"run_id" uuid,
	"result_status" varchar(15) DEFAULT 'pending' NOT NULL,
	"result_detail" jsonb,
	"checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"incident_number" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"severity" varchar(10) DEFAULT 'sev3' NOT NULL,
	"status" varchar(25) DEFAULT 'triggered' NOT NULL,
	"primary_service_id" uuid,
	"status_page_incident_id" uuid,
	"triage_investigation_run_id" uuid,
	"root_cause_summary" text,
	"confidence_score" numeric(5, 4),
	"resolved_at" timestamp,
	"verified_at" timestamp,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_investigation_recommendations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"investigation_run_id" uuid NOT NULL,
	"recommendation_text" text NOT NULL,
	"step_count" integer,
	"confidence_score" numeric(5, 4),
	"application_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"applied_at" timestamp,
	"superseded_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_investigation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"incident_id" uuid,
	"alert_event_id" uuid,
	"agent_type" varchar(25) NOT NULL,
	"status" varchar(15) DEFAULT 'running' NOT NULL,
	"model_id" varchar(100) NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"estimated_cost_cents" integer,
	"confidence_score" numeric(5, 4),
	"root_cause_hypothesis" text,
	"agent_state_snapshot" jsonb,
	"prompt_input" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_investigation_tool_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"investigation_run_id" uuid,
	"connector_id" uuid,
	"connector_type" varchar(50) NOT NULL,
	"tool_name" varchar(100) NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"input_summary" text,
	"raw_input_s3_path" text,
	"output_hash" varchar(64),
	"output_summary" text,
	"raw_output_s3_path" text,
	"status" varchar(15) DEFAULT 'success' NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"cost_estimate_cents" integer,
	"evidence_item_id" uuid,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_runbook_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"runbook_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"instruction" text NOT NULL,
	"agent_assisted" boolean DEFAULT false NOT NULL,
	"evidence_gathering_action" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_runbooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid,
	"name" varchar(200) NOT NULL,
	"description" text,
	"trigger_conditions" jsonb,
	"status" varchar(15) DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_service_dependencies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source_service_id" uuid NOT NULL,
	"target_service_id" uuid NOT NULL,
	"source" varchar(25) NOT NULL,
	"source_ref" varchar(255),
	"confidence" numeric(5, 4),
	"evidence_item_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(15) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_service_dependency_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dependency_id" uuid,
	"source_service_id" uuid NOT NULL,
	"target_service_id" uuid NOT NULL,
	"observed_by" varchar(50) NOT NULL,
	"observation_data" jsonb,
	"confidence" numeric(5, 4) NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_service_deployments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"deployed_at" timestamp NOT NULL,
	"deployed_by" varchar(200),
	"commit_sha" varchar(40),
	"commit_message" text,
	"pr_url" varchar(500),
	"source" varchar(30) NOT NULL,
	"source_ref" varchar(255),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_service_discovery_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"suggestion_type" varchar(20) NOT NULL,
	"suggestion_data" jsonb NOT NULL,
	"source" varchar(50) NOT NULL,
	"confidence" numeric(5, 4),
	"status" varchar(15) DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_service_health_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"health" varchar(10) NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"health_score" numeric(5, 4),
	"signals" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_service_owners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"owner_type" varchar(10) NOT NULL,
	"owner_ref" varchar(200) NOT NULL,
	"role" varchar(50) DEFAULT 'primary' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_service_resources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"resource_type" varchar(30) NOT NULL,
	"resource_id" uuid NOT NULL,
	"relationship" varchar(20) DEFAULT 'monitors' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sre_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"tier" varchar(10) DEFAULT '3' NOT NULL,
	"environment" varchar(50),
	"owner_team" varchar(100),
	"owner_user_id" uuid,
	"runbook_id" uuid,
	"repo_url" varchar(500),
	"otel_service_name" varchar(100),
	"slack_channel" varchar(100),
	"tags" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"merged_into_service_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "overage_pricing" ADD COLUMN "sre_investigation_unit_price_cents" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "sre_investigation_units_used" numeric(10, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "sre_incident_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_limits" ADD COLUMN "sre_investigation_units_included" numeric(10, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_queries" ADD CONSTRAINT "diagnostic_queries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_queries" ADD CONSTRAINT "diagnostic_queries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_queries" ADD CONSTRAINT "diagnostic_queries_connector_id_external_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."external_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_queries" ADD CONSTRAINT "diagnostic_queries_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_queries" ADD CONSTRAINT "diagnostic_queries_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connector_credentials" ADD CONSTRAINT "external_connector_credentials_connector_id_external_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."external_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connector_services" ADD CONSTRAINT "external_connector_services_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connector_services" ADD CONSTRAINT "external_connector_services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connector_services" ADD CONSTRAINT "external_connector_services_connector_id_external_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."external_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connector_services" ADD CONSTRAINT "external_connector_services_service_id_sre_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connectors" ADD CONSTRAINT "external_connectors_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connectors" ADD CONSTRAINT "external_connectors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connectors" ADD CONSTRAINT "external_connectors_private_agent_id_private_agents_id_fk" FOREIGN KEY ("private_agent_id") REFERENCES "public"."private_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connectors" ADD CONSTRAINT "external_connectors_validated_by_private_agent_id_private_agents_id_fk" FOREIGN KEY ("validated_by_private_agent_id") REFERENCES "public"."private_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connectors" ADD CONSTRAINT "external_connectors_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_artifacts" ADD CONSTRAINT "private_agent_artifacts_private_agent_job_id_private_agent_jobs_id_fk" FOREIGN KEY ("private_agent_job_id") REFERENCES "public"."private_agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_artifacts" ADD CONSTRAINT "private_agent_artifacts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_artifacts" ADD CONSTRAINT "private_agent_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_credentials" ADD CONSTRAINT "private_agent_credentials_private_agent_id_private_agents_id_fk" FOREIGN KEY ("private_agent_id") REFERENCES "public"."private_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_credentials" ADD CONSTRAINT "private_agent_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_credentials" ADD CONSTRAINT "private_agent_credentials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_credentials" ADD CONSTRAINT "private_agent_credentials_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_heartbeats" ADD CONSTRAINT "private_agent_heartbeats_private_agent_id_private_agents_id_fk" FOREIGN KEY ("private_agent_id") REFERENCES "public"."private_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_heartbeats" ADD CONSTRAINT "private_agent_heartbeats_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_heartbeats" ADD CONSTRAINT "private_agent_heartbeats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_jobs" ADD CONSTRAINT "private_agent_jobs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_jobs" ADD CONSTRAINT "private_agent_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_jobs" ADD CONSTRAINT "private_agent_jobs_private_agent_id_private_agents_id_fk" FOREIGN KEY ("private_agent_id") REFERENCES "public"."private_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_jobs" ADD CONSTRAINT "private_agent_jobs_connector_id_external_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."external_connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agent_jobs" ADD CONSTRAINT "private_agent_jobs_authorized_by_user_id_user_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agents" ADD CONSTRAINT "private_agents_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agents" ADD CONSTRAINT "private_agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_agents" ADD CONSTRAINT "private_agents_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_ai_suggestions" ADD CONSTRAINT "sre_ai_suggestions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_ai_suggestions" ADD CONSTRAINT "sre_ai_suggestions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_ai_suggestions" ADD CONSTRAINT "sre_ai_suggestions_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_ai_suggestions" ADD CONSTRAINT "sre_ai_suggestions_investigation_run_id_sre_investigation_runs_id_fk" FOREIGN KEY ("investigation_run_id") REFERENCES "public"."sre_investigation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_alert_events" ADD CONSTRAINT "sre_alert_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_alert_events" ADD CONSTRAINT "sre_alert_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_alert_events" ADD CONSTRAINT "sre_alert_events_service_id_sre_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sre_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_background_agent_runs" ADD CONSTRAINT "sre_background_agent_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_background_agent_runs" ADD CONSTRAINT "sre_background_agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_background_agent_runs" ADD CONSTRAINT "sre_background_agent_runs_investigation_run_id_sre_investigation_runs_id_fk" FOREIGN KEY ("investigation_run_id") REFERENCES "public"."sre_investigation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_chat_conversations" ADD CONSTRAINT "sre_chat_conversations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_chat_conversations" ADD CONSTRAINT "sre_chat_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_chat_conversations" ADD CONSTRAINT "sre_chat_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_chat_conversations" ADD CONSTRAINT "sre_chat_conversations_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_chat_messages" ADD CONSTRAINT "sre_chat_messages_conversation_id_sre_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."sre_chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_chat_messages" ADD CONSTRAINT "sre_chat_messages_tool_call_id_sre_investigation_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."sre_investigation_tool_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_chat_messages" ADD CONSTRAINT "sre_chat_messages_investigation_run_id_sre_investigation_runs_id_fk" FOREIGN KEY ("investigation_run_id") REFERENCES "public"."sre_investigation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_observations" ADD CONSTRAINT "sre_context_observations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_observations" ADD CONSTRAINT "sre_context_observations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_observations" ADD CONSTRAINT "sre_context_observations_service_id_sre_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_playbooks" ADD CONSTRAINT "sre_context_playbooks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_playbooks" ADD CONSTRAINT "sre_context_playbooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_playbooks" ADD CONSTRAINT "sre_context_playbooks_promoted_from_recollection_id_sre_context_recollections_id_fk" FOREIGN KEY ("promoted_from_recollection_id") REFERENCES "public"."sre_context_recollections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_playbooks" ADD CONSTRAINT "sre_context_playbooks_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_recollections" ADD CONSTRAINT "sre_context_recollections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_recollections" ADD CONSTRAINT "sre_context_recollections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_recollections" ADD CONSTRAINT "sre_context_recollections_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_context_recollections" ADD CONSTRAINT "sre_context_recollections_service_id_sre_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sre_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_evidence_items" ADD CONSTRAINT "sre_evidence_items_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_evidence_items" ADD CONSTRAINT "sre_evidence_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_evidence_items" ADD CONSTRAINT "sre_evidence_items_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_evidence_items" ADD CONSTRAINT "sre_evidence_items_source_connector_id_external_connectors_id_fk" FOREIGN KEY ("source_connector_id") REFERENCES "public"."external_connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_alerts" ADD CONSTRAINT "sre_incident_alerts_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_alerts" ADD CONSTRAINT "sre_incident_alerts_alert_event_id_sre_alert_events_id_fk" FOREIGN KEY ("alert_event_id") REFERENCES "public"."sre_alert_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_runbook_steps" ADD CONSTRAINT "sre_incident_runbook_steps_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_runbook_steps" ADD CONSTRAINT "sre_incident_runbook_steps_runbook_step_id_sre_runbook_steps_id_fk" FOREIGN KEY ("runbook_step_id") REFERENCES "public"."sre_runbook_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_runbook_steps" ADD CONSTRAINT "sre_incident_runbook_steps_runbook_id_sre_runbooks_id_fk" FOREIGN KEY ("runbook_id") REFERENCES "public"."sre_runbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_runbook_steps" ADD CONSTRAINT "sre_incident_runbook_steps_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_timeline_events" ADD CONSTRAINT "sre_incident_timeline_events_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_timeline_events" ADD CONSTRAINT "sre_incident_timeline_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_timeline_events" ADD CONSTRAINT "sre_incident_timeline_events_agent_run_id_sre_investigation_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."sre_investigation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_timeline_events" ADD CONSTRAINT "sre_incident_timeline_events_evidence_item_id_sre_evidence_items_id_fk" FOREIGN KEY ("evidence_item_id") REFERENCES "public"."sre_evidence_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incident_verifications" ADD CONSTRAINT "sre_incident_verifications_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD CONSTRAINT "sre_incidents_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD CONSTRAINT "sre_incidents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD CONSTRAINT "sre_incidents_primary_service_id_sre_services_id_fk" FOREIGN KEY ("primary_service_id") REFERENCES "public"."sre_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD CONSTRAINT "sre_incidents_status_page_incident_id_incidents_id_fk" FOREIGN KEY ("status_page_incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD CONSTRAINT "sre_incidents_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_investigation_recommendations" ADD CONSTRAINT "sre_investigation_recommendations_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_investigation_recommendations" ADD CONSTRAINT "sre_investigation_recommendations_investigation_run_id_sre_investigation_runs_id_fk" FOREIGN KEY ("investigation_run_id") REFERENCES "public"."sre_investigation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD CONSTRAINT "sre_investigation_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD CONSTRAINT "sre_investigation_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD CONSTRAINT "sre_investigation_runs_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD CONSTRAINT "sre_investigation_runs_alert_event_id_sre_alert_events_id_fk" FOREIGN KEY ("alert_event_id") REFERENCES "public"."sre_alert_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD CONSTRAINT "sre_investigation_runs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_investigation_tool_calls" ADD CONSTRAINT "sre_investigation_tool_calls_investigation_run_id_sre_investigation_runs_id_fk" FOREIGN KEY ("investigation_run_id") REFERENCES "public"."sre_investigation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_investigation_tool_calls" ADD CONSTRAINT "sre_investigation_tool_calls_connector_id_external_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."external_connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_investigation_tool_calls" ADD CONSTRAINT "sre_investigation_tool_calls_evidence_item_id_sre_evidence_items_id_fk" FOREIGN KEY ("evidence_item_id") REFERENCES "public"."sre_evidence_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_runbook_steps" ADD CONSTRAINT "sre_runbook_steps_runbook_id_sre_runbooks_id_fk" FOREIGN KEY ("runbook_id") REFERENCES "public"."sre_runbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_runbooks" ADD CONSTRAINT "sre_runbooks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_runbooks" ADD CONSTRAINT "sre_runbooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_runbooks" ADD CONSTRAINT "sre_runbooks_service_id_sre_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sre_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_runbooks" ADD CONSTRAINT "sre_runbooks_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_dependencies" ADD CONSTRAINT "sre_service_dependencies_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_dependencies" ADD CONSTRAINT "sre_service_dependencies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_dependencies" ADD CONSTRAINT "sre_service_dependencies_source_service_id_sre_services_id_fk" FOREIGN KEY ("source_service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_dependencies" ADD CONSTRAINT "sre_service_dependencies_target_service_id_sre_services_id_fk" FOREIGN KEY ("target_service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_dependencies" ADD CONSTRAINT "sre_service_dependencies_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_dependency_observations" ADD CONSTRAINT "sre_service_dependency_observations_dependency_id_sre_service_dependencies_id_fk" FOREIGN KEY ("dependency_id") REFERENCES "public"."sre_service_dependencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_dependency_observations" ADD CONSTRAINT "sre_service_dependency_observations_source_service_id_sre_services_id_fk" FOREIGN KEY ("source_service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_dependency_observations" ADD CONSTRAINT "sre_service_dependency_observations_target_service_id_sre_services_id_fk" FOREIGN KEY ("target_service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_deployments" ADD CONSTRAINT "sre_service_deployments_service_id_sre_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_deployments" ADD CONSTRAINT "sre_service_deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_discovery_suggestions" ADD CONSTRAINT "sre_service_discovery_suggestions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_discovery_suggestions" ADD CONSTRAINT "sre_service_discovery_suggestions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_discovery_suggestions" ADD CONSTRAINT "sre_service_discovery_suggestions_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_health_snapshots" ADD CONSTRAINT "sre_service_health_snapshots_service_id_sre_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_health_snapshots" ADD CONSTRAINT "sre_service_health_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_owners" ADD CONSTRAINT "sre_service_owners_service_id_sre_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_service_resources" ADD CONSTRAINT "sre_service_resources_service_id_sre_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_services" ADD CONSTRAINT "sre_services_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_services" ADD CONSTRAINT "sre_services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sre_services" ADD CONSTRAINT "sre_services_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnostic_queries_project_connector_idx" ON "diagnostic_queries" USING btree ("project_id","connector_id");--> statement-breakpoint
CREATE INDEX "diagnostic_queries_org_status_idx" ON "diagnostic_queries" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "diagnostic_queries_query_type_status_idx" ON "diagnostic_queries" USING btree ("query_type","status");--> statement-breakpoint
CREATE INDEX "external_connector_credentials_connector_id_idx" ON "external_connector_credentials" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "external_connector_credentials_expires_at_idx" ON "external_connector_credentials" USING btree ("expires_at") WHERE expires_at IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "external_connector_services_connector_service_unique_idx" ON "external_connector_services" USING btree ("connector_id","service_id");--> statement-breakpoint
CREATE INDEX "external_connector_services_project_service_idx" ON "external_connector_services" USING btree ("project_id","service_id");--> statement-breakpoint
CREATE INDEX "external_connector_services_org_connector_idx" ON "external_connector_services" USING btree ("organization_id","connector_id");--> statement-breakpoint
CREATE INDEX "external_connectors_org_type_idx" ON "external_connectors" USING btree ("organization_id","type");--> statement-breakpoint
CREATE INDEX "external_connectors_valid_org_status_idx" ON "external_connectors" USING btree ("organization_id","status") WHERE status = 'valid';--> statement-breakpoint
CREATE INDEX "external_connectors_project_type_idx" ON "external_connectors" USING btree ("project_id","type");--> statement-breakpoint
CREATE INDEX "external_connectors_private_agent_idx" ON "external_connectors" USING btree ("private_agent_id") WHERE private_agent_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "private_agent_artifacts_job_id_idx" ON "private_agent_artifacts" USING btree ("private_agent_job_id");--> statement-breakpoint
CREATE INDEX "private_agent_artifacts_project_type_idx" ON "private_agent_artifacts" USING btree ("project_id","artifact_type");--> statement-breakpoint
CREATE INDEX "private_agent_artifacts_created_at_idx" ON "private_agent_artifacts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "private_agent_credentials_private_agent_id_idx" ON "private_agent_credentials" USING btree ("private_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_agent_credentials_key_id_unique_idx" ON "private_agent_credentials" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "private_agent_credentials_expires_at_idx" ON "private_agent_credentials" USING btree ("expires_at") WHERE expires_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "private_agent_credentials_revoked_at_idx" ON "private_agent_credentials" USING btree ("revoked_at") WHERE revoked_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "private_agent_heartbeats_agent_created_idx" ON "private_agent_heartbeats" USING btree ("private_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "private_agent_heartbeats_org_created_idx" ON "private_agent_heartbeats" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "private_agent_jobs_agent_status_idx" ON "private_agent_jobs" USING btree ("private_agent_id","status");--> statement-breakpoint
CREATE INDEX "private_agent_jobs_project_class_status_idx" ON "private_agent_jobs" USING btree ("project_id","job_class","status");--> statement-breakpoint
CREATE UNIQUE INDEX "private_agent_jobs_idempotency_key_unique_idx" ON "private_agent_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "private_agent_jobs_lease_expires_at_idx" ON "private_agent_jobs" USING btree ("lease_expires_at") WHERE status IN ('leased', 'running');--> statement-breakpoint
CREATE INDEX "private_agents_org_status_idx" ON "private_agents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "private_agents_project_status_idx" ON "private_agents" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "private_agents_mode_status_idx" ON "private_agents" USING btree ("agent_mode","status");--> statement-breakpoint
CREATE INDEX "private_agents_connected_heartbeat_idx" ON "private_agents" USING btree ("last_heartbeat_at") WHERE status = 'connected';--> statement-breakpoint
CREATE INDEX "sre_ai_suggestions_incident_id_idx" ON "sre_ai_suggestions" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "sre_ai_suggestions_type_idx" ON "sre_ai_suggestions" USING btree ("suggestion_type");--> statement-breakpoint
CREATE INDEX "sre_ai_suggestions_incident_type_idx" ON "sre_ai_suggestions" USING btree ("incident_id","suggestion_type");--> statement-breakpoint
CREATE UNIQUE INDEX "sre_alert_events_org_fingerprint_unique_idx" ON "sre_alert_events" USING btree ("organization_id","fingerprint_hash");--> statement-breakpoint
CREATE INDEX "sre_alert_events_project_firing_idx" ON "sre_alert_events" USING btree ("project_id","status") WHERE status = 'firing';--> statement-breakpoint
CREATE INDEX "sre_alert_events_service_status_idx" ON "sre_alert_events" USING btree ("service_id","status");--> statement-breakpoint
CREATE INDEX "sre_alert_events_severity_status_idx" ON "sre_alert_events" USING btree ("severity","status");--> statement-breakpoint
CREATE INDEX "sre_alert_events_fired_at_idx" ON "sre_alert_events" USING btree ("fired_at");--> statement-breakpoint
CREATE INDEX "sre_background_agent_runs_active_project_status_idx" ON "sre_background_agent_runs" USING btree ("project_id","status") WHERE status IN ('scheduled', 'running');--> statement-breakpoint
CREATE INDEX "sre_background_agent_runs_schedule_created_idx" ON "sre_background_agent_runs" USING btree ("schedule_id","created_at");--> statement-breakpoint
CREATE INDEX "sre_chat_conversations_user_updated_at_idx" ON "sre_chat_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "sre_chat_conversations_incident_id_idx" ON "sre_chat_conversations" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "sre_chat_conversations_project_status_idx" ON "sre_chat_conversations" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "sre_chat_messages_conversation_created_idx" ON "sre_chat_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "sre_chat_messages_role_idx" ON "sre_chat_messages" USING btree ("role");--> statement-breakpoint
CREATE INDEX "sre_context_observations_service_id_idx" ON "sre_context_observations" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "sre_context_observations_project_type_idx" ON "sre_context_observations" USING btree ("project_id","observation_type");--> statement-breakpoint
CREATE INDEX "sre_context_playbooks_org_alert_signature_idx" ON "sre_context_playbooks" USING btree ("organization_id","alert_signature_hash");--> statement-breakpoint
CREATE INDEX "sre_context_playbooks_project_status_idx" ON "sre_context_playbooks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "sre_context_playbooks_alert_signature_gin_idx" ON "sre_context_playbooks" USING gin ("alert_signature");--> statement-breakpoint
CREATE INDEX "sre_context_recollections_incident_id_idx" ON "sre_context_recollections" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "sre_context_recollections_service_id_idx" ON "sre_context_recollections" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "sre_context_recollections_error_fingerprint_idx" ON "sre_context_recollections" USING btree ("error_fingerprint");--> statement-breakpoint
CREATE INDEX "sre_evidence_items_incident_id_idx" ON "sre_evidence_items" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "sre_evidence_items_investigation_run_id_idx" ON "sre_evidence_items" USING btree ("investigation_run_id");--> statement-breakpoint
CREATE INDEX "sre_evidence_items_source_connector_idx" ON "sre_evidence_items" USING btree ("source_type","source_connector_id");--> statement-breakpoint
CREATE INDEX "sre_evidence_items_evidence_type_idx" ON "sre_evidence_items" USING btree ("evidence_type");--> statement-breakpoint
CREATE INDEX "sre_evidence_items_observed_at_idx" ON "sre_evidence_items" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "sre_incident_alerts_incident_id_idx" ON "sre_incident_alerts" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "sre_incident_alerts_alert_event_id_idx" ON "sre_incident_alerts" USING btree ("alert_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sre_incident_alerts_incident_alert_unique_idx" ON "sre_incident_alerts" USING btree ("incident_id","alert_event_id");--> statement-breakpoint
CREATE INDEX "sre_incident_runbook_steps_incident_id_idx" ON "sre_incident_runbook_steps" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "sre_incident_runbook_steps_active_status_idx" ON "sre_incident_runbook_steps" USING btree ("incident_id","status") WHERE status IN ('pending', 'in_progress');--> statement-breakpoint
CREATE INDEX "sre_incident_timeline_events_incident_created_idx" ON "sre_incident_timeline_events" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "sre_incident_timeline_events_actor_agent_idx" ON "sre_incident_timeline_events" USING btree ("actor_type","agent_run_id");--> statement-breakpoint
CREATE INDEX "sre_incident_timeline_events_event_type_idx" ON "sre_incident_timeline_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "sre_incident_verifications_incident_id_idx" ON "sre_incident_verifications" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "sre_incident_verifications_active_result_idx" ON "sre_incident_verifications" USING btree ("incident_id","result_status") WHERE result_status IN ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "sre_incidents_org_incident_number_unique_idx" ON "sre_incidents" USING btree ("organization_id","incident_number");--> statement-breakpoint
CREATE INDEX "sre_incidents_project_status_idx" ON "sre_incidents" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "sre_incidents_project_severity_idx" ON "sre_incidents" USING btree ("project_id","severity");--> statement-breakpoint
CREATE INDEX "sre_incidents_primary_service_status_idx" ON "sre_incidents" USING btree ("primary_service_id","status");--> statement-breakpoint
CREATE INDEX "sre_incidents_active_status_idx" ON "sre_incidents" USING btree ("status") WHERE status != 'resolved';--> statement-breakpoint
CREATE INDEX "sre_investigation_recommendations_incident_id_idx" ON "sre_investigation_recommendations" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "sre_investigation_recommendations_pending_incident_idx" ON "sre_investigation_recommendations" USING btree ("incident_id","application_status") WHERE application_status = 'pending';--> statement-breakpoint
CREATE INDEX "sre_investigation_runs_incident_id_idx" ON "sre_investigation_runs" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "sre_investigation_runs_project_status_idx" ON "sre_investigation_runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "sre_investigation_runs_agent_type_status_idx" ON "sre_investigation_runs" USING btree ("agent_type","status");--> statement-breakpoint
CREATE INDEX "sre_investigation_runs_model_id_idx" ON "sre_investigation_runs" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "sre_investigation_runs_low_confidence_idx" ON "sre_investigation_runs" USING btree ("confidence_score") WHERE confidence_score < 0.5;--> statement-breakpoint
CREATE INDEX "sre_investigation_runs_created_at_idx" ON "sre_investigation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sre_investigation_tool_calls_run_id_idx" ON "sre_investigation_tool_calls" USING btree ("investigation_run_id") WHERE investigation_run_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sre_investigation_tool_calls_connector_type_idx" ON "sre_investigation_tool_calls" USING btree ("connector_type");--> statement-breakpoint
CREATE INDEX "sre_investigation_tool_calls_executed_at_idx" ON "sre_investigation_tool_calls" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "sre_runbook_steps_runbook_step_order_idx" ON "sre_runbook_steps" USING btree ("runbook_id","step_order");--> statement-breakpoint
CREATE INDEX "sre_runbooks_project_service_idx" ON "sre_runbooks" USING btree ("project_id","service_id");--> statement-breakpoint
CREATE INDEX "sre_runbooks_org_name_idx" ON "sre_runbooks" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sre_service_dependencies_active_unique_idx" ON "sre_service_dependencies" USING btree ("source_service_id","target_service_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "sre_service_dependencies_target_service_idx" ON "sre_service_dependencies" USING btree ("target_service_id");--> statement-breakpoint
CREATE INDEX "sre_service_dependencies_project_status_idx" ON "sre_service_dependencies" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "sre_service_dependencies_last_seen_at_idx" ON "sre_service_dependencies" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "sre_service_dependencies_pending_approval_idx" ON "sre_service_dependencies" USING btree ("approved_at") WHERE approved_at IS NULL;--> statement-breakpoint
CREATE INDEX "sre_service_dependency_observations_dependency_id_idx" ON "sre_service_dependency_observations" USING btree ("dependency_id");--> statement-breakpoint
CREATE INDEX "sre_service_dependency_observations_edge_idx" ON "sre_service_dependency_observations" USING btree ("source_service_id","target_service_id");--> statement-breakpoint
CREATE INDEX "sre_service_dependency_observations_observed_at_idx" ON "sre_service_dependency_observations" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "sre_service_deployments_service_deployed_at_idx" ON "sre_service_deployments" USING btree ("service_id","deployed_at");--> statement-breakpoint
CREATE INDEX "sre_service_deployments_project_deployed_at_idx" ON "sre_service_deployments" USING btree ("project_id","deployed_at");--> statement-breakpoint
CREATE INDEX "sre_service_deployments_commit_sha_idx" ON "sre_service_deployments" USING btree ("commit_sha");--> statement-breakpoint
CREATE INDEX "sre_service_discovery_suggestions_project_pending_idx" ON "sre_service_discovery_suggestions" USING btree ("project_id","status") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "sre_service_discovery_suggestions_org_source_idx" ON "sre_service_discovery_suggestions" USING btree ("organization_id","source");--> statement-breakpoint
CREATE INDEX "sre_service_health_snapshots_service_window_idx" ON "sre_service_health_snapshots" USING btree ("service_id","window_end");--> statement-breakpoint
CREATE INDEX "sre_service_health_snapshots_project_health_idx" ON "sre_service_health_snapshots" USING btree ("project_id","health");--> statement-breakpoint
CREATE INDEX "sre_service_health_snapshots_window_end_idx" ON "sre_service_health_snapshots" USING btree ("window_end");--> statement-breakpoint
CREATE INDEX "sre_service_owners_service_id_idx" ON "sre_service_owners" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "sre_service_owners_owner_type_ref_idx" ON "sre_service_owners" USING btree ("owner_type","owner_ref");--> statement-breakpoint
CREATE INDEX "sre_service_resources_service_id_idx" ON "sre_service_resources" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "sre_service_resources_resource_idx" ON "sre_service_resources" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sre_service_resources_service_resource_unique_idx" ON "sre_service_resources" USING btree ("service_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "sre_services_project_org_status_idx" ON "sre_services" USING btree ("project_id","organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sre_services_active_project_name_unique_idx" ON "sre_services" USING btree ("organization_id","project_id","name") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "sre_services_project_environment_idx" ON "sre_services" USING btree ("project_id","environment");--> statement-breakpoint
CREATE INDEX "sre_services_project_tier_idx" ON "sre_services" USING btree ("project_id","tier");
