-- Alert receipt for legacy (worker-aggregated) monitor check groups. The worker used to keep it inside
-- monitor_results.details and rewrite each result row twice after inserting it; with the receipt here,
-- result rows stay insert-only. Additive: a new, empty table, so the FK takes only a brief lock on monitors.
-- Workers that predate this table keep using details; newer workers read both.
CREATE TABLE "monitor_group_evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"monitor_id" uuid NOT NULL,
	"execution_group_id" text NOT NULL,
	"evaluation" jsonb NOT NULL,
	"notification_processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitor_group_evaluations" ADD CONSTRAINT "monitor_group_evaluations_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monitor_group_evaluations_group_idx" ON "monitor_group_evaluations" USING btree ("monitor_id","execution_group_id");--> statement-breakpoint
CREATE INDEX "monitor_group_evaluations_created_at_idx" ON "monitor_group_evaluations" USING btree ("created_at");