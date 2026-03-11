-- Replace cloud-specific seed locations with a single 'local' default.
-- For fresh installs, 0006 now seeds 'local' directly.
-- For existing installs that still have the original cloud seeds,
-- this migration replaces them with a generic default.
--
-- Safety: We only delete a seed location when ALL of these conditions hold:
--   1. The code + name match the original seeds exactly
--   2. No project_locations restrictions reference it
--   3. No monitor_results have been recorded at that location
--   4. No execution runs have been recorded at that location
-- This ensures multi-region deployments with real worker activity keep
-- their locations even if project_locations is unused (the common case).

-- Step 1: Insert 'local' if it doesn't exist
INSERT INTO "locations" ("code", "name", "region", "flag", "is_default", "sort_order", "coordinates")
VALUES ('local', 'Local', 'Default', '🖥️', true, 0, '{"lat": 49.4521, "lon": 11.0767}')
ON CONFLICT ("code") DO NOTHING;

-- Step 2: Remove old cloud seeds only when no real usage exists.
DELETE FROM "locations" l
WHERE l.code IN ('us-east', 'eu-central', 'asia-pacific')
  AND l.name IN ('US East', 'EU Central', 'Asia Pacific')
  AND NOT EXISTS (
    SELECT 1 FROM "project_locations" pl WHERE pl.location_id = l.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "monitor_results" mr WHERE mr.location = l.code
  )
  AND NOT EXISTS (
    SELECT 1 FROM "runs" r WHERE r.location = l.code
  );
