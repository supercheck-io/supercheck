CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"action" varchar(255) NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"project_id" uuid,
	"refill_interval" text,
	"refill_amount" text,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" text DEFAULT '60',
	"rate_limit_max" text DEFAULT '100',
	"request_count" text,
	"remaining" text,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	"active_project_id" uuid,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "billing_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"monthly_spending_limit_cents" integer,
	"enable_spending_limit" boolean DEFAULT false NOT NULL,
	"hard_stop_on_limit" boolean DEFAULT false NOT NULL,
	"notify_at_50_percent" boolean DEFAULT false NOT NULL,
	"notify_at_80_percent" boolean DEFAULT true NOT NULL,
	"notify_at_90_percent" boolean DEFAULT true NOT NULL,
	"notify_at_100_percent" boolean DEFAULT true NOT NULL,
	"notification_emails" text,
	"last_notification_sent_at" timestamp,
	"notifications_sent_this_period" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "overage_pricing" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"playwright_minute_price_cents" integer NOT NULL,
	"k6_vu_hour_price_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "overage_pricing_plan_unique" UNIQUE("plan")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_name" text NOT NULL,
	"units" numeric(10, 4) NOT NULL,
	"unit_type" text NOT NULL,
	"metadata" text,
	"synced_to_polar" boolean DEFAULT false NOT NULL,
	"polar_event_id" text,
	"sync_error" text,
	"sync_attempts" integer DEFAULT 0 NOT NULL,
	"last_sync_attempt" timestamp,
	"billing_period_start" timestamp NOT NULL,
	"billing_period_end" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"notification_type" text NOT NULL,
	"resource_type" text NOT NULL,
	"usage_amount" numeric(10, 4) NOT NULL,
	"usage_limit" numeric(10, 4) NOT NULL,
	"usage_percentage" integer NOT NULL,
	"current_spending_cents" integer,
	"spending_limit_cents" integer,
	"sent_to" text NOT NULL,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"delivery_error" text,
	"billing_period_start" timestamp NOT NULL,
	"billing_period_end" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" uuid NOT NULL,
	"selected_projects" text
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'project_viewer' NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "member_user_id_organization_id_unique" UNIQUE("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	"polar_customer_id" text,
	"subscription_plan" text,
	"subscription_status" text DEFAULT 'none',
	"subscription_id" text,
	"playwright_minutes_used" integer DEFAULT 0,
	"k6_vu_hours_used" integer DEFAULT 0,
	"usage_period_start" timestamp,
	"usage_period_end" timestamp,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role" varchar(50) DEFAULT 'project_viewer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_user_id_project_id_unique" UNIQUE("user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "project_variables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"encrypted_value" text,
	"is_secret" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_variables_project_id_key_unique" UNIQUE("project_id","key")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255),
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"project_id" uuid,
	"created_by_user_id" uuid,
	"title" varchar(255) NOT NULL,
	"description" text,
	"script" text DEFAULT '' NOT NULL,
	"priority" varchar(50) DEFAULT 'medium' NOT NULL,
	"type" varchar(50) DEFAULT 'browser' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "job_tests" (
	"job_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"order_position" integer,
	CONSTRAINT "job_test_cases_pk" PRIMARY KEY("job_id","test_case_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"project_id" uuid,
	"created_by_user_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text,
	"job_type" varchar(20) DEFAULT 'playwright' NOT NULL,
	"cron_schedule" varchar(100),
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"alert_config" jsonb,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"scheduled_job_id" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid,
	"project_id" uuid,
	"status" varchar(50) DEFAULT 'running' NOT NULL,
	"duration" varchar(100),
	"duration_ms" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"report_s3_url" text,
	"logs_s3_url" text,
	"video_s3_url" text,
	"screenshots_s3_path" text,
	"artifact_paths" jsonb,
	"logs" text,
	"location" varchar(50),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"error_details" text,
	"trigger" varchar(50) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "k6_performance_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"test_id" uuid,
	"job_id" uuid,
	"run_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"location" varchar(50) DEFAULT 'global',
	"status" varchar(20) NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"duration_ms" integer,
	"summary_json" jsonb,
	"thresholds_passed" boolean,
	"total_requests" integer,
	"failed_requests" integer,
	"request_rate" integer,
	"avg_response_time_ms" integer,
	"p95_response_time_ms" integer,
	"p99_response_time_ms" integer,
	"report_s3_url" text,
	"summary_s3_url" text,
	"console_s3_url" text,
	"error_details" text,
	"console_output" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "monitor_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"monitor_id" uuid NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"location" varchar(50) DEFAULT 'eu-central' NOT NULL,
	"status" varchar(50) NOT NULL,
	"response_time_ms" integer,
	"details" jsonb,
	"is_up" boolean NOT NULL,
	"is_status_change" boolean DEFAULT false NOT NULL,
	"consecutive_failure_count" integer DEFAULT 0 NOT NULL,
	"alerts_sent_for_failure" integer DEFAULT 0 NOT NULL,
	"test_execution_id" text,
	"test_report_s3_url" text
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"project_id" uuid,
	"created_by_user_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" varchar(50) NOT NULL,
	"target" varchar(2048) NOT NULL,
	"frequency_minutes" integer DEFAULT 5 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"config" jsonb,
	"alert_config" jsonb,
	"last_check_at" timestamp,
	"last_status_change_at" timestamp,
	"muted_until" timestamp,
	"scheduled_job_id" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "alert_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"type" varchar(50) NOT NULL,
	"target" varchar(255) NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"monitor_id" uuid,
	"job_id" uuid,
	"provider" varchar(100) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp DEFAULT now(),
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"monitor_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"notification_providers" jsonb,
	"alert_on_failure" boolean DEFAULT true NOT NULL,
	"alert_on_recovery" boolean DEFAULT true,
	"alert_on_ssl_expiration" boolean DEFAULT false,
	"alert_on_success" boolean DEFAULT false,
	"alert_on_timeout" boolean DEFAULT false,
	"failure_threshold" integer DEFAULT 1 NOT NULL,
	"recovery_threshold" integer DEFAULT 1 NOT NULL,
	"custom_message" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_notification_settings" (
	"job_id" uuid NOT NULL,
	"notification_provider_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "job_notification_settings_job_id_notification_provider_id_pk" PRIMARY KEY("job_id","notification_provider_id")
);
--> statement-breakpoint
CREATE TABLE "monitor_notification_settings" (
	"monitor_id" uuid NOT NULL,
	"notification_provider_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "monitor_notification_settings_pk" PRIMARY KEY("monitor_id","notification_provider_id")
);
--> statement-breakpoint
CREATE TABLE "notification_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"project_id" uuid,
	"created_by_user_id" uuid,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"config" jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(50) DEFAULT 'email' NOT NULL,
	"content" jsonb NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "monitor_tags" (
	"monitor_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"assigned_at" timestamp DEFAULT now(),
	CONSTRAINT "monitor_tags_monitor_id_tag_id_pk" PRIMARY KEY("monitor_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"project_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"name" varchar(100) NOT NULL,
	"color" varchar(50),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "test_tags" (
	"test_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"assigned_at" timestamp DEFAULT now(),
	CONSTRAINT "test_tags_test_id_tag_id_pk" PRIMARY KEY("test_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"created_by_user_id" uuid,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" text NOT NULL,
	"report_path" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'running' NOT NULL,
	"s3_url" varchar(1024),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "incident_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"old_status" varchar(50),
	"new_status" varchar(50),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "incident_template_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "incident_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status_page_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"name" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"update_status" varchar(50) DEFAULT 'investigating',
	"should_send_notifications" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "incident_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"body" text NOT NULL,
	"status" varchar(50) DEFAULT 'investigating' NOT NULL,
	"deliver_notifications" boolean DEFAULT true,
	"display_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status_page_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"name" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'investigating' NOT NULL,
	"impact" varchar(50) DEFAULT 'minor' NOT NULL,
	"impact_override" varchar(50),
	"body" text,
	"scheduled_for" timestamp,
	"scheduled_until" timestamp,
	"scheduled_remind_prior" boolean DEFAULT true,
	"auto_transition_to_maintenance_state" boolean DEFAULT true,
	"auto_transition_to_operational_state" boolean DEFAULT true,
	"scheduled_auto_in_progress" boolean DEFAULT true,
	"scheduled_auto_completed" boolean DEFAULT true,
	"auto_transition_deliver_notifications_at_start" boolean DEFAULT true,
	"auto_transition_deliver_notifications_at_end" boolean DEFAULT true,
	"reminder_intervals" varchar(100) DEFAULT '[3,6,12,24]',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"deliver_notifications" boolean DEFAULT true,
	"backfill_date" timestamp,
	"backfilled" boolean DEFAULT false,
	"monitoring_at" timestamp,
	"resolved_at" timestamp,
	"shortlink" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "postmortems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"body" text NOT NULL,
	"body_last_updated_at" timestamp DEFAULT now(),
	"ignored" boolean DEFAULT false,
	"notified_subscribers" boolean DEFAULT false,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "status_page_component_monitors" (
	"component_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "status_page_component_monitors_component_id_monitor_id_pk" PRIMARY KEY("component_id","monitor_id")
);
--> statement-breakpoint
CREATE TABLE "status_page_component_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "status_page_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status_page_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(50) DEFAULT 'operational' NOT NULL,
	"showcase" boolean DEFAULT true,
	"only_show_if_degraded" boolean DEFAULT false,
	"automation_email" varchar(255),
	"start_date" timestamp,
	"position" integer DEFAULT 0,
	"aggregation_method" varchar(50) DEFAULT 'worst_case' NOT NULL,
	"failure_threshold" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "status_page_incident_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "status_page_metrics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status_page_id" uuid NOT NULL,
	"component_id" uuid,
	"date" timestamp NOT NULL,
	"uptime_percentage" varchar(10),
	"total_checks" integer DEFAULT 0,
	"successful_checks" integer DEFAULT 0,
	"failed_checks" integer DEFAULT 0,
	"average_response_time_ms" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "status_page_subscribers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status_page_id" uuid NOT NULL,
	"email" varchar(255),
	"endpoint" varchar(500),
	"mode" varchar(50) NOT NULL,
	"skip_confirmation_notification" boolean DEFAULT false,
	"quarantined_at" timestamp,
	"purge_at" timestamp,
	"verified_at" timestamp,
	"verification_token" varchar(255),
	"unsubscribe_token" varchar(255),
	"webhook_secret" varchar(255),
	"webhook_failures" integer DEFAULT 0,
	"webhook_last_attempt_at" timestamp,
	"webhook_last_error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "status_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"created_by_user_id" uuid,
	"name" varchar(255) NOT NULL,
	"subdomain" varchar(36) NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"page_description" text,
	"headline" varchar(255),
	"support_url" varchar(500),
	"allow_page_subscribers" boolean DEFAULT true,
	"allow_incident_subscribers" boolean DEFAULT true,
	"allow_email_subscribers" boolean DEFAULT true,
	"allow_webhook_subscribers" boolean DEFAULT true,
	"allow_slack_subscribers" boolean DEFAULT true,
	"allow_rss_feed" boolean DEFAULT true,
	"notifications_from_email" varchar(255),
	"notifications_email_footer" text,
	"timezone" varchar(50) DEFAULT 'UTC',
	"css_body_background_color" varchar(7) DEFAULT '#ffffff',
	"css_font_color" varchar(7) DEFAULT '#333333',
	"css_light_font_color" varchar(7) DEFAULT '#666666',
	"css_greens" varchar(7) DEFAULT '#2ecc71',
	"css_yellows" varchar(7) DEFAULT '#f1c40f',
	"css_oranges" varchar(7) DEFAULT '#e67e22',
	"css_blues" varchar(7) DEFAULT '#3498db',
	"css_reds" varchar(7) DEFAULT '#e74c3c',
	"css_border_color" varchar(7) DEFAULT '#ecf0f1',
	"css_graph_color" varchar(7) DEFAULT '#3498db',
	"css_link_color" varchar(7) DEFAULT '#3498db',
	"css_no_data" varchar(7) DEFAULT '#bdc3c7',
	"favicon_logo" varchar(500),
	"transactional_logo" varchar(500),
	"hero_cover" varchar(500),
	"custom_domain" varchar(255),
	"custom_domain_verified" boolean DEFAULT false,
	"theme" jsonb DEFAULT '{}'::jsonb,
	"branding_settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "status_pages_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "plan_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"max_monitors" integer NOT NULL,
	"min_check_interval_minutes" integer NOT NULL,
	"playwright_minutes_included" integer NOT NULL,
	"k6_vu_hours_included" integer NOT NULL,
	"running_capacity" integer NOT NULL,
	"queued_capacity" integer NOT NULL,
	"max_team_members" integer NOT NULL,
	"max_organizations" integer NOT NULL,
	"max_projects" integer NOT NULL,
	"max_status_pages" integer NOT NULL,
	"custom_domains" boolean DEFAULT false NOT NULL,
	"sso_enabled" boolean DEFAULT false NOT NULL,
	"data_retention_days" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plan_limits_plan_unique" UNIQUE("plan")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_project_id_projects_id_fk" FOREIGN KEY ("active_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_notifications" ADD CONSTRAINT "usage_notifications_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variables" ADD CONSTRAINT "project_variables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variables" ADD CONSTRAINT "project_variables_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_tests" ADD CONSTRAINT "job_tests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_tests" ADD CONSTRAINT "job_tests_test_case_id_tests_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k6_performance_runs" ADD CONSTRAINT "k6_performance_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k6_performance_runs" ADD CONSTRAINT "k6_performance_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k6_performance_runs" ADD CONSTRAINT "k6_performance_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k6_performance_runs" ADD CONSTRAINT "k6_performance_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_results" ADD CONSTRAINT "monitor_results_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_notification_settings" ADD CONSTRAINT "job_notification_settings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_notification_settings" ADD CONSTRAINT "job_notification_settings_notification_provider_id_notification_providers_id_fk" FOREIGN KEY ("notification_provider_id") REFERENCES "public"."notification_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_notification_settings" ADD CONSTRAINT "monitor_notification_settings_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_notification_settings" ADD CONSTRAINT "monitor_notification_settings_notification_provider_id_notification_providers_id_fk" FOREIGN KEY ("notification_provider_id") REFERENCES "public"."notification_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_providers" ADD CONSTRAINT "notification_providers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_providers" ADD CONSTRAINT "notification_providers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_providers" ADD CONSTRAINT "notification_providers_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_tags" ADD CONSTRAINT "monitor_tags_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_tags" ADD CONSTRAINT "monitor_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_tags" ADD CONSTRAINT "test_tags_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_tags" ADD CONSTRAINT "test_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_components" ADD CONSTRAINT "incident_components_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_components" ADD CONSTRAINT "incident_components_component_id_status_page_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."status_page_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_template_components" ADD CONSTRAINT "incident_template_components_template_id_incident_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."incident_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_template_components" ADD CONSTRAINT "incident_template_components_component_id_status_page_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."status_page_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_templates" ADD CONSTRAINT "incident_templates_status_page_id_status_pages_id_fk" FOREIGN KEY ("status_page_id") REFERENCES "public"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_templates" ADD CONSTRAINT "incident_templates_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_status_page_id_status_pages_id_fk" FOREIGN KEY ("status_page_id") REFERENCES "public"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postmortems" ADD CONSTRAINT "postmortems_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postmortems" ADD CONSTRAINT "postmortems_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_component_monitors" ADD CONSTRAINT "status_page_component_monitors_component_id_status_page_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."status_page_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_component_monitors" ADD CONSTRAINT "status_page_component_monitors_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_component_subscriptions" ADD CONSTRAINT "status_page_component_subscriptions_subscriber_id_status_page_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."status_page_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_component_subscriptions" ADD CONSTRAINT "status_page_component_subscriptions_component_id_status_page_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."status_page_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_components" ADD CONSTRAINT "status_page_components_status_page_id_status_pages_id_fk" FOREIGN KEY ("status_page_id") REFERENCES "public"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_incident_subscriptions" ADD CONSTRAINT "status_page_incident_subscriptions_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_incident_subscriptions" ADD CONSTRAINT "status_page_incident_subscriptions_subscriber_id_status_page_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."status_page_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_metrics" ADD CONSTRAINT "status_page_metrics_status_page_id_status_pages_id_fk" FOREIGN KEY ("status_page_id") REFERENCES "public"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_metrics" ADD CONSTRAINT "status_page_metrics_component_id_status_page_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."status_page_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_subscribers" ADD CONSTRAINT "status_page_subscribers_status_page_id_status_pages_id_fk" FOREIGN KEY ("status_page_id") REFERENCES "public"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_provider_account_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "apikey_user_id_idx" ON "apikey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_project_id_idx" ON "apikey" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "apikey_job_id_idx" ON "apikey" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "apikey_enabled_idx" ON "apikey" USING btree ("enabled") WHERE enabled = true;--> statement-breakpoint
CREATE INDEX "apikey_expires_at_idx" ON "apikey" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "session_active_org_idx" ON "session" USING btree ("active_organization_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "billing_settings_org_id_idx" ON "billing_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "usage_events_org_id_idx" ON "usage_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "usage_events_event_type_idx" ON "usage_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "usage_events_synced_idx" ON "usage_events" USING btree ("synced_to_polar");--> statement-breakpoint
CREATE INDEX "usage_events_billing_period_idx" ON "usage_events" USING btree ("billing_period_start","billing_period_end");--> statement-breakpoint
CREATE INDEX "usage_events_created_at_idx" ON "usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_notifications_org_id_idx" ON "usage_notifications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "usage_notifications_type_idx" ON "usage_notifications" USING btree ("notification_type");--> statement-breakpoint
CREATE INDEX "usage_notifications_billing_period_idx" ON "usage_notifications" USING btree ("billing_period_start","billing_period_end");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitation_email_status_idx" ON "invitation" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "invitation_expires_at_idx" ON "invitation" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "projects_organization_id_idx" ON "projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "projects_org_status_idx" ON "projects" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "projects_is_default_idx" ON "projects" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX "tests_organization_id_idx" ON "tests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tests_project_id_idx" ON "tests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tests_project_type_idx" ON "tests" USING btree ("project_id","type");--> statement-breakpoint
CREATE INDEX "tests_type_idx" ON "tests" USING btree ("type");--> statement-breakpoint
CREATE INDEX "tests_created_at_idx" ON "tests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "jobs_organization_id_idx" ON "jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "jobs_project_id_idx" ON "jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "jobs_project_status_idx" ON "jobs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_next_run_at_idx" ON "jobs" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "jobs_created_at_idx" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "runs_job_id_idx" ON "runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "runs_project_id_idx" ON "runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "runs_job_status_idx" ON "runs" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_created_at_idx" ON "runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "runs_completed_at_idx" ON "runs" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "runs_project_created_at_idx" ON "runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "monitor_results_monitor_location_checked_idx" ON "monitor_results" USING btree ("monitor_id","location","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_project_name_idx" ON "tags" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_entity_type_id_idx" ON "reports" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "postmortems_incident_idx" ON "postmortems" USING btree ("incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "status_page_metrics_date_component_idx" ON "status_page_metrics" USING btree ("status_page_id","component_id","date");