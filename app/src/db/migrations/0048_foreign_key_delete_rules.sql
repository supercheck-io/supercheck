-- Make every foreign key's ON DELETE rule deliberate so deleting a user, organization or
-- private agent does not fail on a forgotten reference and history survives.
--   audit_logs.organization_id   : FK dropped (audit history outlives the organization)
--   audit_logs.user_id           : NO ACTION -> SET NULL
--   *.created_by_user_id (12)    : NO ACTION -> SET NULL
--   apikey.user_id, notifications.user_id : NO ACTION -> CASCADE
--   session.active_organization_id / active_project_id : NO ACTION -> SET NULL
--   external_connectors / private_agent_jobs .private_agent_id : RESTRICT -> NO ACTION
-- projects.organization_id and runs.job_id stay NO ACTION on purpose (S3 cleanup happens first).
-- Existing rows already satisfy the old FKs, so each new FK is added NOT VALID then validated.
-- Re-runnable. Forward-only.
-- Fail fast instead of queueing behind a long transaction and blocking sign-ins.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '10min';
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "audit_logs" VALIDATE CONSTRAINT "audit_logs_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_organization_id_organization_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "apikey" DROP CONSTRAINT IF EXISTS "apikey_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE "apikey" VALIDATE CONSTRAINT "apikey_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_active_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "organization"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "session" VALIDATE CONSTRAINT "session_active_organization_id_organization_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_active_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_project_id_projects_id_fk" FOREIGN KEY ("active_project_id") REFERENCES "projects"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "session" VALIDATE CONSTRAINT "session_active_project_id_projects_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "project_variables" DROP CONSTRAINT IF EXISTS "project_variables_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "project_variables" ADD CONSTRAINT "project_variables_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "project_variables" VALIDATE CONSTRAINT "project_variables_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "tests" DROP CONSTRAINT IF EXISTS "tests_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "tests" VALIDATE CONSTRAINT "tests_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitors" DROP CONSTRAINT IF EXISTS "monitors_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "monitors" VALIDATE CONSTRAINT "monitors_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "notification_providers" DROP CONSTRAINT IF EXISTS "notification_providers_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_providers" ADD CONSTRAINT "notification_providers_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "notification_providers" VALIDATE CONSTRAINT "notification_providers_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "tags" VALIDATE CONSTRAINT "tags_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "reports" VALIDATE CONSTRAINT "reports_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incident_templates" DROP CONSTRAINT IF EXISTS "incident_templates_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "incident_templates" ADD CONSTRAINT "incident_templates_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "incident_templates" VALIDATE CONSTRAINT "incident_templates_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incident_updates" DROP CONSTRAINT IF EXISTS "incident_updates_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "incident_updates" VALIDATE CONSTRAINT "incident_updates_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incidents" DROP CONSTRAINT IF EXISTS "incidents_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "incidents" VALIDATE CONSTRAINT "incidents_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "postmortems" DROP CONSTRAINT IF EXISTS "postmortems_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "postmortems" ADD CONSTRAINT "postmortems_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "postmortems" VALIDATE CONSTRAINT "postmortems_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_pages" DROP CONSTRAINT IF EXISTS "status_pages_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE "status_pages" VALIDATE CONSTRAINT "status_pages_created_by_user_id_user_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "external_connectors" DROP CONSTRAINT IF EXISTS "external_connectors_private_agent_id_private_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "external_connectors" ADD CONSTRAINT "external_connectors_private_agent_id_private_agents_id_fk" FOREIGN KEY ("private_agent_id") REFERENCES "private_agents"("id") ON DELETE NO ACTION NOT VALID;
--> statement-breakpoint
ALTER TABLE "external_connectors" VALIDATE CONSTRAINT "external_connectors_private_agent_id_private_agents_id_fk";
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "private_agent_jobs" DROP CONSTRAINT IF EXISTS "private_agent_jobs_private_agent_id_private_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "private_agent_jobs" ADD CONSTRAINT "private_agent_jobs_private_agent_id_private_agents_id_fk" FOREIGN KEY ("private_agent_id") REFERENCES "private_agents"("id") ON DELETE NO ACTION NOT VALID;
--> statement-breakpoint
ALTER TABLE "private_agent_jobs" VALIDATE CONSTRAINT "private_agent_jobs_private_agent_id_private_agents_id_fk";
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
