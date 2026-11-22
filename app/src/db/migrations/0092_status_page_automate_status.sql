-- Monitor-driven component status is opt-in: every component starts manual, existing ones included.
ALTER TABLE "status_page_components" ADD COLUMN "automate_status" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Open automatic incidents become ordinary updates the owner resolves; nothing resolves them automatically any more.
UPDATE "incidents" SET "source_component_id" = NULL WHERE "source_component_id" IS NOT NULL AND "status" <> 'resolved';--> statement-breakpoint
-- An outage status that monitors set, with no open update behind it, would otherwise stay on the public page.
-- Monitors set it only when one of them was reporting (not paused or pending) and not being deleted; with every
-- linked monitor paused the stored status was the owner's and is kept.
UPDATE "status_page_components" AS c SET "status" = 'operational', "updated_at" = now()
WHERE c."status" IN ('degraded_performance', 'partial_outage', 'major_outage')
  AND EXISTS (
    SELECT 1 FROM "status_page_component_monitors" m JOIN "monitors" mon ON mon."id" = m."monitor_id"
    WHERE m."component_id" = c."id" AND mon."status" NOT IN ('paused', 'pending') AND mon."deleting_at" IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "incident_components" ic JOIN "incidents" i ON i."id" = ic."incident_id"
    WHERE ic."component_id" = c."id" AND i."status" NOT IN ('resolved', 'scheduled')
  );--> statement-breakpoint
-- Resolved updates without a resolution time would count as open in the uptime history: end them at their
-- latest resolved update, or at their last change when there is none.
UPDATE "incidents" AS i SET "resolved_at" = COALESCE(
  (SELECT max(COALESCE(u."display_at", u."created_at")) FROM "incident_updates" u WHERE u."incident_id" = i."id" AND u."status" = 'resolved'),
  i."updated_at", i."created_at"
)
WHERE i."status" = 'resolved' AND i."resolved_at" IS NULL;
