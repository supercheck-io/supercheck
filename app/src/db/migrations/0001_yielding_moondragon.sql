CREATE TABLE "requirement_coverage_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requirement_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'missing' NOT NULL,
	"linked_test_count" integer DEFAULT 0 NOT NULL,
	"passed_test_count" integer DEFAULT 0 NOT NULL,
	"failed_test_count" integer DEFAULT 0 NOT NULL,
	"last_failed_test_id" uuid,
	"last_failed_at" timestamp,
	"last_evaluated_at" timestamp DEFAULT now(),
	"updated_at" timestamp,
	CONSTRAINT "requirement_coverage_snapshots_requirement_id_unique" UNIQUE("requirement_id")
);
--> statement-breakpoint
CREATE TABLE "requirement_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"storage_path" varchar(500) NOT NULL,
	"file_size" integer,
	"uploaded_by_user_id" uuid,
	"uploaded_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"priority" varchar(10) DEFAULT 'medium',
	"tags" text,
	"source_document_id" uuid,
	"source_section" varchar(255),
	"external_id" varchar(255),
	"external_url" text,
	"external_provider" varchar(50),
	"external_synced_at" timestamp,
	"created_by" varchar(10) DEFAULT 'user' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "test_requirements" (
	"test_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "requirement_coverage_snapshots" ADD CONSTRAINT "requirement_coverage_snapshots_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_coverage_snapshots" ADD CONSTRAINT "requirement_coverage_snapshots_last_failed_test_id_tests_id_fk" FOREIGN KEY ("last_failed_test_id") REFERENCES "public"."tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_documents" ADD CONSTRAINT "requirement_documents_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_documents" ADD CONSTRAINT "requirement_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_documents" ADD CONSTRAINT "requirement_documents_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_source_document_id_requirement_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."requirement_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_requirements" ADD CONSTRAINT "test_requirements_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_requirements" ADD CONSTRAINT "test_requirements_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirement_coverage_snapshots_requirement_id_idx" ON "requirement_coverage_snapshots" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "requirement_coverage_snapshots_status_idx" ON "requirement_coverage_snapshots" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requirement_documents_project_id_idx" ON "requirement_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "requirement_documents_uploaded_at_idx" ON "requirement_documents" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX "requirement_documents_project_uploaded_at_idx" ON "requirement_documents" USING btree ("project_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "requirements_organization_id_idx" ON "requirements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "requirements_project_id_idx" ON "requirements" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "requirements_project_priority_idx" ON "requirements" USING btree ("project_id","priority");--> statement-breakpoint
CREATE INDEX "requirements_external_id_idx" ON "requirements" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "requirements_created_at_idx" ON "requirements" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "test_requirements_pk" ON "test_requirements" USING btree ("test_id","requirement_id");--> statement-breakpoint
CREATE INDEX "test_requirements_test_id_idx" ON "test_requirements" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "test_requirements_requirement_id_idx" ON "test_requirements" USING btree ("requirement_id");