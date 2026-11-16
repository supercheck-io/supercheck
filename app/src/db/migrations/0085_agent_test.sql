-- Agent test type. The type check is swapped NOT VALID (as in 0082) so the swap does not scan the table;
-- old rows only use the previous values, and db-migrate.js validates the constraint after commit.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "tests" DROP CONSTRAINT IF EXISTS "tests_type_check";--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_type_check" CHECK ("tests"."type" IN ('browser', 'api', 'database', 'custom', 'performance', 'agent')) NOT VALID;--> statement-breakpoint
RESET lock_timeout;
