CREATE TABLE IF NOT EXISTS "sre_integration_bindings" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "integration_key" varchar(50) NOT NULL,
  "notification_provider_id" uuid NOT NULL,
  "external_connector_id" uuid NOT NULL,
  "correlation_strategy" varchar(30) DEFAULT 'dedup_key' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_by_user_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sre_int_bindings_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_int_bindings_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_int_bindings_provider_fk"
    FOREIGN KEY ("notification_provider_id") REFERENCES "public"."notification_providers"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_int_bindings_connector_fk"
    FOREIGN KEY ("external_connector_id") REFERENCES "public"."external_connectors"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_int_bindings_created_by_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sre_integration_binding_services" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "binding_id" uuid NOT NULL,
  "service_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sre_int_binding_services_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_int_binding_services_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_int_binding_services_binding_fk"
    FOREIGN KEY ("binding_id") REFERENCES "public"."sre_integration_bindings"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_int_binding_services_service_fk"
    FOREIGN KEY ("service_id") REFERENCES "public"."sre_services"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_integration_bindings_project_integration_idx"
  ON "sre_integration_bindings" USING btree ("project_id", "integration_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_integration_bindings_notification_provider_idx"
  ON "sre_integration_bindings" USING btree ("notification_provider_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_integration_bindings_external_connector_idx"
  ON "sre_integration_bindings" USING btree ("external_connector_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sre_integration_bindings_active_unique_idx"
  ON "sre_integration_bindings" USING btree ("project_id", "integration_key", "notification_provider_id", "external_connector_id")
  WHERE enabled = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sre_integration_binding_services_binding_service_unique_idx"
  ON "sre_integration_binding_services" USING btree ("binding_id", "service_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_integration_binding_services_service_idx"
  ON "sre_integration_binding_services" USING btree ("project_id", "service_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_integration_binding_services_org_binding_idx"
  ON "sre_integration_binding_services" USING btree ("organization_id", "binding_id");
