-- Per-location workload capabilities. Defaults keep every existing location
-- (including self-hosted "local") eligible for browser and k6 execution.
-- Cloud policy (e.g. probe-only regions) is set explicitly in Super Admin, not here.
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "supports_browser" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "supports_k6" boolean DEFAULT true NOT NULL;
