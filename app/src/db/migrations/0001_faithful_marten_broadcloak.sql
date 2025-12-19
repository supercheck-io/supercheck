CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_organization_id_idx" ON "audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_org_created_idx" ON "audit_logs" USING btree ("action","organization_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_started_at_idx" ON "runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "monitor_results_checked_at_idx" ON "monitor_results" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "monitor_results_monitor_checked_idx" ON "monitor_results" USING btree ("monitor_id","checked_at");--> statement-breakpoint
CREATE INDEX "monitors_project_org_idx" ON "monitors" USING btree ("project_id","organization_id");--> statement-breakpoint
CREATE INDEX "monitors_project_org_status_idx" ON "monitors" USING btree ("project_id","organization_id","status");