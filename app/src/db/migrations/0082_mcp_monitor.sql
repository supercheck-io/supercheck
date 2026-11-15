-- migration-safety: allow-destructive issue=#736
ALTER TABLE "monitors" DROP CONSTRAINT IF EXISTS "monitors_type_check";--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_type_check" CHECK ("monitors"."type" IN ('http_request', 'website', 'ping_host', 'port_check', 'synthetic_test', 'heartbeat', 'mcp_server')) NOT VALID;--> statement-breakpoint
ALTER TABLE "monitors" VALIDATE CONSTRAINT "monitors_type_check";
