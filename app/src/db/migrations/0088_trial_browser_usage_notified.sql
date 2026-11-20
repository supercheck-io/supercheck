ALTER TABLE "execution_entitlements" ALTER COLUMN "playwright_budget_ms" SET DEFAULT 60000000;--> statement-breakpoint
ALTER TABLE "execution_entitlements" ADD COLUMN "browser_half_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "execution_entitlements" ADD COLUMN "browser_full_notified_at" timestamp with time zone;