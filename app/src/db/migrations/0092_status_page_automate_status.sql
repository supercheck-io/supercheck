-- Monitor-driven component status is opt-in: every component starts manual, existing ones included.
ALTER TABLE "status_page_components" ADD COLUMN "automate_status" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Open automatic incidents become ordinary updates the owner resolves; nothing resolves them automatically any more.
UPDATE "incidents" SET "source_component_id" = NULL WHERE "source_component_id" IS NOT NULL AND "status" <> 'resolved';--> statement-breakpoint
-- An outage status set by monitors, with no open update behind it, would otherwise stay on the public page.
UPDATE "status_page_components" AS c SET "status" = 'operational', "updated_at" = now()
WHERE c."status" IN ('degraded_performance', 'partial_outage', 'major_outage')
  AND EXISTS (SELECT 1 FROM "status_page_component_monitors" m WHERE m."component_id" = c."id")
  AND NOT EXISTS (
    SELECT 1 FROM "incident_components" ic JOIN "incidents" i ON i."id" = ic."incident_id"
    WHERE ic."component_id" = c."id" AND i."status" NOT IN ('resolved', 'scheduled')
  );
