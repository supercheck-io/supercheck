CREATE INDEX "k6_runs_project_org_idx" ON "k6_performance_runs" USING btree ("project_id","organization_id");--> statement-breakpoint
CREATE INDEX "k6_runs_started_at_idx" ON "k6_performance_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "k6_runs_run_id_idx" ON "k6_performance_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "alert_history_sent_at_idx" ON "alert_history" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "alert_history_monitor_id_idx" ON "alert_history" USING btree ("monitor_id");--> statement-breakpoint
CREATE INDEX "alert_history_job_id_idx" ON "alert_history" USING btree ("job_id");