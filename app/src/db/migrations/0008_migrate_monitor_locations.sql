-- Migrate existing monitor location configs from cloud locations to "local".
-- Monitors created before the dynamic-locations feature may still reference
-- the old cloud-specific location codes (us-east, eu-central, asia-pacific)
-- in their config->'locationConfig'->'locations' array.
--
-- This migration rewrites those arrays to ["local"] ONLY when the referenced
-- locations do not exist as enabled rows in the locations table.
-- If a deployment has registered and enabled those location codes (e.g. a
-- multi-location setup), the monitor configs are preserved as-is.
--
-- Monitors that already include "local" in their locations are left untouched.
-- Monitors whose config has no locationConfig are also skipped.

UPDATE monitors
SET config = jsonb_set(
  config,
  '{locationConfig,locations}',
  '["local"]'::jsonb
)
WHERE config->'locationConfig' IS NOT NULL
  AND config->'locationConfig'->'locations' IS NOT NULL
  AND (
    config->'locationConfig'->'locations' @> '"us-east"'::jsonb
    OR config->'locationConfig'->'locations' @> '"eu-central"'::jsonb
    OR config->'locationConfig'->'locations' @> '"asia-pacific"'::jsonb
  )
  AND NOT (config->'locationConfig'->'locations' @> '"local"'::jsonb)
  -- Only rewrite when NONE of the referenced cloud locations exist as enabled in the locations table
  AND NOT EXISTS (
    SELECT 1 FROM locations l
    WHERE l.is_enabled = true
      AND l.code IN ('us-east', 'eu-central', 'asia-pacific')
  );

-- Also update the column default for monitor_results.location from "eu-central" to "local".
ALTER TABLE "monitor_results" ALTER COLUMN "location" SET DEFAULT 'local';

-- Backfill default coordinates for the 'local' location if it was seeded with NULL.
-- Uses EU Central (Nuremberg, Germany) as a sensible default so the globe UI renders a marker.
UPDATE "locations"
SET coordinates = '{"lat": 49.4521, "lon": 11.0767}'::jsonb
WHERE code = 'local'
  AND coordinates IS NULL;
