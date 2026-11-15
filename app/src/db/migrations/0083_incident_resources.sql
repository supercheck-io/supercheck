CREATE TABLE "sre_incident_resources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"resource_type" varchar(10) NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sre_incident_resources_resource_type_check" CHECK ("sre_incident_resources"."resource_type" IN ('service', 'monitor'))
);
--> statement-breakpoint
ALTER TABLE "sre_incident_resources" ADD CONSTRAINT "sre_incident_resources_incident_id_sre_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sre_incident_resources_incident_resource_unique_idx" ON "sre_incident_resources" USING btree ("incident_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "sre_incident_resources_resource_idx" ON "sre_incident_resources" USING btree ("resource_type","resource_id");