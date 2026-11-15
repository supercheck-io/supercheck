-- MCP monitor type. The type check is swapped NOT VALID (as in 0081) so the swap does not scan the table;
-- old rows only use the previous values, and db-migrate.js validates the constraint after commit.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitors" DROP CONSTRAINT IF EXISTS "monitors_type_check";--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_type_check" CHECK ("monitors"."type" IN ('http_request', 'website', 'ping_host', 'port_check', 'synthetic_test', 'heartbeat', 'mcp_server')) NOT VALID;--> statement-breakpoint
RESET lock_timeout;
