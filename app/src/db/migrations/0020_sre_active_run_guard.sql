WITH ranked_active_runs AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "organization_id", "project_id", "incident_id", "agent_type"
      ORDER BY "started_at" DESC, "id" DESC
    ) AS active_rank
  FROM "sre_investigation_runs"
  WHERE "status" = 'running'
    AND "incident_id" IS NOT NULL
)
UPDATE "sre_investigation_runs" AS runs
SET
  "status" = 'failed',
  "completed_at" = COALESCE(runs."completed_at", now()),
  "agent_state_snapshot" = COALESCE(runs."agent_state_snapshot", '{}'::jsonb)
    || jsonb_build_object(
      'recoveryReason',
      'superseded_duplicate_running_investigation'
    )
FROM ranked_active_runs
WHERE runs."id" = ranked_active_runs."id"
  AND ranked_active_runs.active_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "sre_investigation_runs_active_incident_unique"
ON "sre_investigation_runs" (
  "organization_id",
  "project_id",
  "incident_id",
  "agent_type"
)
WHERE "status" = 'running'
  AND "incident_id" IS NOT NULL;
