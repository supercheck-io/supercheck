-- Create locations table (instance-wide execution locations)
CREATE TABLE IF NOT EXISTS "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(63) NOT NULL,
	"name" varchar(100) NOT NULL,
	"region" varchar(100),
	"flag" varchar(10),
	"coordinates" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "locations_code_unique" UNIQUE("code")
);

-- Create project_locations table (per-project restrictions)
CREATE TABLE IF NOT EXISTS "project_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_locations_unique" UNIQUE("project_id","location_id")
);

-- Add foreign keys
DO $$ BEGIN
 ALTER TABLE "project_locations" ADD CONSTRAINT "project_locations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_locations" ADD CONSTRAINT "project_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_locations_enabled" ON "locations" USING btree ("is_enabled");
CREATE INDEX IF NOT EXISTS "idx_locations_sort_order" ON "locations" USING btree ("sort_order");
CREATE INDEX IF NOT EXISTS "idx_project_locations_project" ON "project_locations" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "idx_project_locations_location" ON "project_locations" USING btree ("location_id");

-- Seed a single default location matching the default WORKER_LOCATION=local.
-- For cloud multi-region deployments, delete this and add region-specific locations via Super Admin.
-- Only insert if table is empty (idempotent).
INSERT INTO "locations" ("code", "name", "region", "flag", "is_default", "sort_order", "coordinates")
SELECT * FROM (VALUES
  ('local'::varchar, 'Local'::varchar, 'Default'::varchar, '🖥️'::varchar, true, 0, '{"lat": 49.4521, "lon": 11.0767}'::jsonb)
) AS v(code, name, region, flag, is_default, sort_order, coordinates)
WHERE NOT EXISTS (SELECT 1 FROM "locations" LIMIT 1);
