-- Make the database enforce what the code already assumes: relationships, uniqueness and required
-- tenant columns. Everything existing data could violate uses a "guarded validate": the constraint is
-- added NOT VALID (so every new write is enforced immediately), then validated only when no existing row
-- violates it. Otherwise a warning names the constraint and the row count and it stays NOT VALID, so an
-- unknown data shape can never fail the deploy. Unique indexes are created only when no duplicate exists.
--   * optional references that had no FK: dangling ids are set to NULL (no rows are deleted), then FK ... ON DELETE SET NULL
--   * unique: organization customer/subscription references (replace the plain partial indexes), pending
--     invitations per organization and lower(email), service owners, template components, status page hostnames lowercase
--   * required columns as CHECK (col IS NOT NULL) NOT VALID: no SET NOT NULL, so nothing is rewritten or scanned under a hard lock
--   * usage counters: NULL -> 0 (the documented default), then required
-- Re-runnable. Forward-only.
-- Fail fast instead of queueing behind a long transaction and blocking sign-ins.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '10min';
--> statement-breakpoint
-- 1. Foreign keys on optional references: clear dangling ids, then ON DELETE SET NULL.
UPDATE "k6_performance_runs" SET "test_id" = NULL WHERE "test_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "tests" p WHERE p."id" = "k6_performance_runs"."test_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "k6_performance_runs" DROP CONSTRAINT IF EXISTS "k6_performance_runs_test_id_fkey";
--> statement-breakpoint
ALTER TABLE "k6_performance_runs" ADD CONSTRAINT "k6_performance_runs_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "k6_performance_runs" WHERE "test_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "tests" p WHERE p."id" = "k6_performance_runs"."test_id")) THEN
    ALTER TABLE "k6_performance_runs" VALIDATE CONSTRAINT "k6_performance_runs_test_id_fkey";
  ELSE
    SELECT count(*) INTO violating FROM "k6_performance_runs" WHERE "test_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "tests" p WHERE p."id" = "k6_performance_runs"."test_id");
    RAISE WARNING 'k6_performance_runs_test_id_fkey left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "incidents" SET "sre_incident_id" = NULL WHERE "sre_incident_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_incidents" p WHERE p."id" = "incidents"."sre_incident_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "incidents" DROP CONSTRAINT IF EXISTS "incidents_sre_incident_id_fkey";
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_sre_incident_id_fkey" FOREIGN KEY ("sre_incident_id") REFERENCES "sre_incidents"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "incidents" WHERE "sre_incident_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_incidents" p WHERE p."id" = "incidents"."sre_incident_id")) THEN
    ALTER TABLE "incidents" VALIDATE CONSTRAINT "incidents_sre_incident_id_fkey";
  ELSE
    SELECT count(*) INTO violating FROM "incidents" WHERE "sre_incident_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_incidents" p WHERE p."id" = "incidents"."sre_incident_id");
    RAISE WARNING 'incidents_sre_incident_id_fkey left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "sre_alert_events" SET "triage_investigation_run_id" = NULL WHERE "triage_investigation_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_runs" p WHERE p."id" = "sre_alert_events"."triage_investigation_run_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_alert_events" DROP CONSTRAINT IF EXISTS "sre_alert_events_triage_investigation_run_id_fkey";
--> statement-breakpoint
ALTER TABLE "sre_alert_events" ADD CONSTRAINT "sre_alert_events_triage_investigation_run_id_fkey" FOREIGN KEY ("triage_investigation_run_id") REFERENCES "sre_investigation_runs"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "sre_alert_events" WHERE "triage_investigation_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_runs" p WHERE p."id" = "sre_alert_events"."triage_investigation_run_id")) THEN
    ALTER TABLE "sre_alert_events" VALIDATE CONSTRAINT "sre_alert_events_triage_investigation_run_id_fkey";
  ELSE
    SELECT count(*) INTO violating FROM "sre_alert_events" WHERE "triage_investigation_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_runs" p WHERE p."id" = "sre_alert_events"."triage_investigation_run_id");
    RAISE WARNING 'sre_alert_events_triage_investigation_run_id_fkey left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "sre_incidents" SET "triage_investigation_run_id" = NULL WHERE "triage_investigation_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_runs" p WHERE p."id" = "sre_incidents"."triage_investigation_run_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_incidents" DROP CONSTRAINT IF EXISTS "sre_incidents_triage_investigation_run_id_fkey";
--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD CONSTRAINT "sre_incidents_triage_investigation_run_id_fkey" FOREIGN KEY ("triage_investigation_run_id") REFERENCES "sre_investigation_runs"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "sre_incidents" WHERE "triage_investigation_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_runs" p WHERE p."id" = "sre_incidents"."triage_investigation_run_id")) THEN
    ALTER TABLE "sre_incidents" VALIDATE CONSTRAINT "sre_incidents_triage_investigation_run_id_fkey";
  ELSE
    SELECT count(*) INTO violating FROM "sre_incidents" WHERE "triage_investigation_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_runs" p WHERE p."id" = "sre_incidents"."triage_investigation_run_id");
    RAISE WARNING 'sre_incidents_triage_investigation_run_id_fkey left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "sre_evidence_items" SET "investigation_run_id" = NULL WHERE "investigation_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_runs" p WHERE p."id" = "sre_evidence_items"."investigation_run_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_evidence_items" DROP CONSTRAINT IF EXISTS "sre_evidence_items_investigation_run_id_fkey";
--> statement-breakpoint
ALTER TABLE "sre_evidence_items" ADD CONSTRAINT "sre_evidence_items_investigation_run_id_fkey" FOREIGN KEY ("investigation_run_id") REFERENCES "sre_investigation_runs"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "sre_evidence_items" WHERE "investigation_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_runs" p WHERE p."id" = "sre_evidence_items"."investigation_run_id")) THEN
    ALTER TABLE "sre_evidence_items" VALIDATE CONSTRAINT "sre_evidence_items_investigation_run_id_fkey";
  ELSE
    SELECT count(*) INTO violating FROM "sre_evidence_items" WHERE "investigation_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_runs" p WHERE p."id" = "sre_evidence_items"."investigation_run_id");
    RAISE WARNING 'sre_evidence_items_investigation_run_id_fkey left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "sre_investigation_recommendations" SET "superseded_by_id" = NULL WHERE "superseded_by_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_recommendations" p WHERE p."id" = "sre_investigation_recommendations"."superseded_by_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_investigation_recommendations" DROP CONSTRAINT IF EXISTS "sre_investigation_recommendations_superseded_by_id_fkey";
--> statement-breakpoint
ALTER TABLE "sre_investigation_recommendations" ADD CONSTRAINT "sre_investigation_recommendations_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "sre_investigation_recommendations"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "sre_investigation_recommendations" WHERE "superseded_by_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_recommendations" p WHERE p."id" = "sre_investigation_recommendations"."superseded_by_id")) THEN
    ALTER TABLE "sre_investigation_recommendations" VALIDATE CONSTRAINT "sre_investigation_recommendations_superseded_by_id_fkey";
  ELSE
    SELECT count(*) INTO violating FROM "sre_investigation_recommendations" WHERE "superseded_by_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_investigation_recommendations" p WHERE p."id" = "sre_investigation_recommendations"."superseded_by_id");
    RAISE WARNING 'sre_investigation_recommendations_superseded_by_id_fkey left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "sre_context_recollections" SET "promoted_to_playbook_id" = NULL WHERE "promoted_to_playbook_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_context_playbooks" p WHERE p."id" = "sre_context_recollections"."promoted_to_playbook_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_context_recollections" DROP CONSTRAINT IF EXISTS "sre_context_recollections_promoted_to_playbook_id_fkey";
--> statement-breakpoint
ALTER TABLE "sre_context_recollections" ADD CONSTRAINT "sre_context_recollections_promoted_to_playbook_id_fkey" FOREIGN KEY ("promoted_to_playbook_id") REFERENCES "sre_context_playbooks"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "sre_context_recollections" WHERE "promoted_to_playbook_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_context_playbooks" p WHERE p."id" = "sre_context_recollections"."promoted_to_playbook_id")) THEN
    ALTER TABLE "sre_context_recollections" VALIDATE CONSTRAINT "sre_context_recollections_promoted_to_playbook_id_fkey";
  ELSE
    SELECT count(*) INTO violating FROM "sre_context_recollections" WHERE "promoted_to_playbook_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_context_playbooks" p WHERE p."id" = "sre_context_recollections"."promoted_to_playbook_id");
    RAISE WARNING 'sre_context_recollections_promoted_to_playbook_id_fkey left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "sre_service_dependencies" SET "evidence_item_id" = NULL WHERE "evidence_item_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_evidence_items" p WHERE p."id" = "sre_service_dependencies"."evidence_item_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_service_dependencies" DROP CONSTRAINT IF EXISTS "sre_service_dependencies_evidence_item_id_fkey";
--> statement-breakpoint
ALTER TABLE "sre_service_dependencies" ADD CONSTRAINT "sre_service_dependencies_evidence_item_id_fkey" FOREIGN KEY ("evidence_item_id") REFERENCES "sre_evidence_items"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "sre_service_dependencies" WHERE "evidence_item_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_evidence_items" p WHERE p."id" = "sre_service_dependencies"."evidence_item_id")) THEN
    ALTER TABLE "sre_service_dependencies" VALIDATE CONSTRAINT "sre_service_dependencies_evidence_item_id_fkey";
  ELSE
    SELECT count(*) INTO violating FROM "sre_service_dependencies" WHERE "evidence_item_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_evidence_items" p WHERE p."id" = "sre_service_dependencies"."evidence_item_id");
    RAISE WARNING 'sre_service_dependencies_evidence_item_id_fkey left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "sre_services" SET "runbook_id" = NULL WHERE "runbook_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_runbooks" p WHERE p."id" = "sre_services"."runbook_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_services" DROP CONSTRAINT IF EXISTS "sre_services_runbook_id_fkey";
--> statement-breakpoint
ALTER TABLE "sre_services" ADD CONSTRAINT "sre_services_runbook_id_fkey" FOREIGN KEY ("runbook_id") REFERENCES "sre_runbooks"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "sre_services" WHERE "runbook_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_runbooks" p WHERE p."id" = "sre_services"."runbook_id")) THEN
    ALTER TABLE "sre_services" VALIDATE CONSTRAINT "sre_services_runbook_id_fkey";
  ELSE
    SELECT count(*) INTO violating FROM "sre_services" WHERE "runbook_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_runbooks" p WHERE p."id" = "sre_services"."runbook_id");
    RAISE WARNING 'sre_services_runbook_id_fkey left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "sre_services" SET "merged_into_service_id" = NULL WHERE "merged_into_service_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_services" p WHERE p."id" = "sre_services"."merged_into_service_id");
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "sre_services" DROP CONSTRAINT IF EXISTS "sre_services_merged_into_service_id_fkey";
--> statement-breakpoint
ALTER TABLE "sre_services" ADD CONSTRAINT "sre_services_merged_into_service_id_fkey" FOREIGN KEY ("merged_into_service_id") REFERENCES "sre_services"("id") ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "sre_services" WHERE "merged_into_service_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_services" p WHERE p."id" = "sre_services"."merged_into_service_id")) THEN
    ALTER TABLE "sre_services" VALIDATE CONSTRAINT "sre_services_merged_into_service_id_fkey";
  ELSE
    SELECT count(*) INTO violating FROM "sre_services" WHERE "merged_into_service_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sre_services" p WHERE p."id" = "sre_services"."merged_into_service_id");
    RAISE WARNING 'sre_services_merged_into_service_id_fkey left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- Index the new foreign key columns (sre_evidence_items.investigation_run_id is already indexed).
CREATE INDEX "k6_performance_runs_test_id_idx" ON "k6_performance_runs" ("test_id");
--> statement-breakpoint
CREATE INDEX "incidents_sre_incident_id_idx" ON "incidents" ("sre_incident_id");
--> statement-breakpoint
CREATE INDEX "sre_alert_events_triage_investigation_run_id_idx" ON "sre_alert_events" ("triage_investigation_run_id");
--> statement-breakpoint
CREATE INDEX "sre_incidents_triage_investigation_run_id_idx" ON "sre_incidents" ("triage_investigation_run_id");
--> statement-breakpoint
CREATE INDEX "sre_investigation_recommendations_superseded_by_id_idx" ON "sre_investigation_recommendations" ("superseded_by_id");
--> statement-breakpoint
CREATE INDEX "sre_context_recollections_promoted_to_playbook_id_idx" ON "sre_context_recollections" ("promoted_to_playbook_id");
--> statement-breakpoint
CREATE INDEX "sre_service_dependencies_evidence_item_id_idx" ON "sre_service_dependencies" ("evidence_item_id");
--> statement-breakpoint
CREATE INDEX "sre_services_runbook_id_idx" ON "sre_services" ("runbook_id");
--> statement-breakpoint
CREATE INDEX "sre_services_merged_into_service_id_idx" ON "sre_services" ("merged_into_service_id");
--> statement-breakpoint
-- 3. Uniqueness. Created only when no duplicate exists; otherwise a warning and the existing index stays.
-- migration-safety: allow-destructive issue=#736
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "organization" WHERE "polar_customer_id" IS NOT NULL GROUP BY "polar_customer_id" HAVING count(*) > 1) THEN
    DROP INDEX IF EXISTS "organization_polar_customer_id_idx";
    CREATE UNIQUE INDEX "organization_polar_customer_id_idx" ON "organization" ("polar_customer_id") WHERE "polar_customer_id" IS NOT NULL;
  ELSE
    RAISE WARNING 'organization_polar_customer_id_idx not created: duplicate rows exist, plain index kept';
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "organization" WHERE "subscription_id" IS NOT NULL GROUP BY "subscription_id" HAVING count(*) > 1) THEN
    DROP INDEX IF EXISTS "organization_subscription_id_idx";
    CREATE UNIQUE INDEX "organization_subscription_id_idx" ON "organization" ("subscription_id") WHERE "subscription_id" IS NOT NULL;
  ELSE
    RAISE WARNING 'organization_subscription_id_idx not created: duplicate rows exist, plain index kept';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "invitation" WHERE "status" = 'pending' GROUP BY "organization_id", lower("email") HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX "invitation_pending_org_email_unique_idx" ON "invitation" ("organization_id", lower("email")) WHERE "status" = 'pending';
  ELSE
    RAISE WARNING 'invitation_pending_org_email_unique_idx not created: duplicate rows exist';
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "sre_service_owners" GROUP BY "service_id", "owner_type", "owner_ref", "role" HAVING count(*) > 1) THEN
    DROP INDEX IF EXISTS "sre_service_owners_service_id_idx";
    CREATE UNIQUE INDEX "sre_service_owners_unique_idx" ON "sre_service_owners" ("service_id", "owner_type", "owner_ref", "role");
  ELSE
    RAISE WARNING 'sre_service_owners_unique_idx not created: duplicate rows exist, sre_service_owners_service_id_idx kept';
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "incident_template_components" GROUP BY "template_id", "component_id" HAVING count(*) > 1) THEN
    DROP INDEX IF EXISTS "incident_template_components_template_id_idx";
    CREATE UNIQUE INDEX "incident_template_components_unique_idx" ON "incident_template_components" ("template_id", "component_id");
  ELSE
    RAISE WARNING 'incident_template_components_unique_idx not created: duplicate rows exist, incident_template_components_template_id_idx kept';
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_pages" DROP CONSTRAINT IF EXISTS "status_pages_subdomain_lowercase_check";
--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_subdomain_lowercase_check" CHECK ("subdomain" = lower("subdomain")) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "status_pages" WHERE "subdomain" <> lower("subdomain")) THEN
    ALTER TABLE "status_pages" VALIDATE CONSTRAINT "status_pages_subdomain_lowercase_check";
  ELSE
    SELECT count(*) INTO violating FROM "status_pages" WHERE "subdomain" <> lower("subdomain");
    RAISE WARNING 'status_pages_subdomain_lowercase_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_pages" DROP CONSTRAINT IF EXISTS "status_pages_custom_domain_lowercase_check";
--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_custom_domain_lowercase_check" CHECK ("custom_domain" = lower("custom_domain")) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "status_pages" WHERE "custom_domain" <> lower("custom_domain")) THEN
    ALTER TABLE "status_pages" VALIDATE CONSTRAINT "status_pages_custom_domain_lowercase_check";
  ELSE
    SELECT count(*) INTO violating FROM "status_pages" WHERE "custom_domain" <> lower("custom_domain");
    RAISE WARNING 'status_pages_custom_domain_lowercase_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- 4. Required tenant columns as CHECK ... NOT VALID (not SET NOT NULL). reports.organization_id is deliberately absent:
--    the execution worker records report metadata without an organization.
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "runs_project_id_required_check";
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_required_check" CHECK ("project_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "runs" WHERE "project_id" IS NULL) THEN
    ALTER TABLE "runs" VALIDATE CONSTRAINT "runs_project_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "runs" WHERE "project_id" IS NULL;
    RAISE WARNING 'runs_project_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "tests" DROP CONSTRAINT IF EXISTS "tests_organization_id_required_check";
--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_organization_id_required_check" CHECK ("organization_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "tests" WHERE "organization_id" IS NULL) THEN
    ALTER TABLE "tests" VALIDATE CONSTRAINT "tests_organization_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "tests" WHERE "organization_id" IS NULL;
    RAISE WARNING 'tests_organization_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "tests" DROP CONSTRAINT IF EXISTS "tests_project_id_required_check";
--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_project_id_required_check" CHECK ("project_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "tests" WHERE "project_id" IS NULL) THEN
    ALTER TABLE "tests" VALIDATE CONSTRAINT "tests_project_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "tests" WHERE "project_id" IS NULL;
    RAISE WARNING 'tests_project_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_organization_id_required_check";
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_required_check" CHECK ("organization_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "jobs" WHERE "organization_id" IS NULL) THEN
    ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_organization_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "jobs" WHERE "organization_id" IS NULL;
    RAISE WARNING 'jobs_organization_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_project_id_required_check";
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_required_check" CHECK ("project_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "jobs" WHERE "project_id" IS NULL) THEN
    ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_project_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "jobs" WHERE "project_id" IS NULL;
    RAISE WARNING 'jobs_project_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitors" DROP CONSTRAINT IF EXISTS "monitors_organization_id_required_check";
--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_organization_id_required_check" CHECK ("organization_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "monitors" WHERE "organization_id" IS NULL) THEN
    ALTER TABLE "monitors" VALIDATE CONSTRAINT "monitors_organization_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "monitors" WHERE "organization_id" IS NULL;
    RAISE WARNING 'monitors_organization_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitors" DROP CONSTRAINT IF EXISTS "monitors_project_id_required_check";
--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_project_id_required_check" CHECK ("project_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "monitors" WHERE "project_id" IS NULL) THEN
    ALTER TABLE "monitors" VALIDATE CONSTRAINT "monitors_project_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "monitors" WHERE "project_id" IS NULL;
    RAISE WARNING 'monitors_project_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "notification_providers" DROP CONSTRAINT IF EXISTS "notification_providers_organization_id_required_check";
--> statement-breakpoint
ALTER TABLE "notification_providers" ADD CONSTRAINT "notification_providers_organization_id_required_check" CHECK ("organization_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "notification_providers" WHERE "organization_id" IS NULL) THEN
    ALTER TABLE "notification_providers" VALIDATE CONSTRAINT "notification_providers_organization_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "notification_providers" WHERE "organization_id" IS NULL;
    RAISE WARNING 'notification_providers_organization_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "notification_providers" DROP CONSTRAINT IF EXISTS "notification_providers_project_id_required_check";
--> statement-breakpoint
ALTER TABLE "notification_providers" ADD CONSTRAINT "notification_providers_project_id_required_check" CHECK ("project_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "notification_providers" WHERE "project_id" IS NULL) THEN
    ALTER TABLE "notification_providers" VALIDATE CONSTRAINT "notification_providers_project_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "notification_providers" WHERE "project_id" IS NULL;
    RAISE WARNING 'notification_providers_project_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_organization_id_required_check";
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_required_check" CHECK ("organization_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "tags" WHERE "organization_id" IS NULL) THEN
    ALTER TABLE "tags" VALIDATE CONSTRAINT "tags_organization_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "tags" WHERE "organization_id" IS NULL;
    RAISE WARNING 'tags_organization_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "alerts" DROP CONSTRAINT IF EXISTS "alerts_organization_id_required_check";
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_required_check" CHECK ("organization_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "alerts" WHERE "organization_id" IS NULL) THEN
    ALTER TABLE "alerts" VALIDATE CONSTRAINT "alerts_organization_id_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "alerts" WHERE "organization_id" IS NULL;
    RAISE WARNING 'alerts_organization_id_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "alert_history" DROP CONSTRAINT IF EXISTS "alert_history_target_required_check";
--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_target_required_check" CHECK ("monitor_id" IS NOT NULL OR "job_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "alert_history" WHERE "monitor_id" IS NULL AND "job_id" IS NULL) THEN
    ALTER TABLE "alert_history" VALIDATE CONSTRAINT "alert_history_target_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "alert_history" WHERE "monitor_id" IS NULL AND "job_id" IS NULL;
    RAISE WARNING 'alert_history_target_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "organization" SET "playwright_minutes_used" = 0 WHERE "playwright_minutes_used" IS NULL;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_playwright_minutes_used_required_check";
--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_playwright_minutes_used_required_check" CHECK ("playwright_minutes_used" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "organization" WHERE "playwright_minutes_used" IS NULL) THEN
    ALTER TABLE "organization" VALIDATE CONSTRAINT "organization_playwright_minutes_used_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "organization" WHERE "playwright_minutes_used" IS NULL;
    RAISE WARNING 'organization_playwright_minutes_used_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "organization" SET "k6_vu_minutes_used" = 0 WHERE "k6_vu_minutes_used" IS NULL;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_k6_vu_minutes_used_required_check";
--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_k6_vu_minutes_used_required_check" CHECK ("k6_vu_minutes_used" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "organization" WHERE "k6_vu_minutes_used" IS NULL) THEN
    ALTER TABLE "organization" VALIDATE CONSTRAINT "organization_k6_vu_minutes_used_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "organization" WHERE "k6_vu_minutes_used" IS NULL;
    RAISE WARNING 'organization_k6_vu_minutes_used_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "organization" SET "ai_credits_used" = 0 WHERE "ai_credits_used" IS NULL;
--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_ai_credits_used_required_check";
--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_ai_credits_used_required_check" CHECK ("ai_credits_used" IS NOT NULL) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE violating bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "organization" WHERE "ai_credits_used" IS NULL) THEN
    ALTER TABLE "organization" VALIDATE CONSTRAINT "organization_ai_credits_used_required_check";
  ELSE
    SELECT count(*) INTO violating FROM "organization" WHERE "ai_credits_used" IS NULL;
    RAISE WARNING 'organization_ai_credits_used_required_check left NOT VALID: % violating rows', violating;
  END IF;
END $$;
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
