ALTER TABLE "notification_policies" ADD COLUMN "renotify_repeat_minutes" integer;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD COLUMN "renotify_max" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD COLUMN "escalate_after_minutes" integer;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD COLUMN "escalate_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD COLUMN "escalate_user_id" uuid;--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN "renotify_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN "renotify_stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_escalate_channel_id_notification_providers_id_fk" FOREIGN KEY ("escalate_channel_id") REFERENCES "public"."notification_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_escalate_user_id_user_id_fk" FOREIGN KEY ("escalate_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_policies_escalate_channel_id_idx" ON "notification_policies" USING btree ("escalate_channel_id");--> statement-breakpoint
CREATE INDEX "notification_policies_escalate_user_id_idx" ON "notification_policies" USING btree ("escalate_user_id");--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_renotify_repeat_range_check" CHECK ("notification_policies"."renotify_repeat_minutes" IS NULL OR ("notification_policies"."renotify_repeat_minutes" BETWEEN 5 AND 1440));--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_renotify_max_range_check" CHECK ("notification_policies"."renotify_max" BETWEEN 1 AND 10);--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_escalate_range_check" CHECK ("notification_policies"."escalate_after_minutes" IS NULL OR ("notification_policies"."escalate_after_minutes" BETWEEN 5 AND 1440));--> statement-breakpoint
-- Incidents already reminded under the old remind-once rule count as one reminder, so they are not reminded again.
UPDATE "sre_incidents" SET "renotify_count" = 1 WHERE "renotified_at" IS NOT NULL;