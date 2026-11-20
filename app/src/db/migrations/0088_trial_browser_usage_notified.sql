ALTER TABLE "execution_entitlements" ALTER COLUMN "playwright_budget_ms" SET DEFAULT 60000000;--> statement-breakpoint
ALTER TABLE "execution_entitlements" ADD COLUMN "browser_half_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "execution_entitlements" ADD COLUMN "browser_full_notified_at" timestamp with time zone;--> statement-breakpoint
-- Active trials still on the old 150-minute budget move to 1,000 minutes, so what the app shows matches what
-- they get, and usage measured against the new budget does not fire 50%/100% emails for everyone on deploy.
UPDATE "execution_entitlements" SET "playwright_budget_ms" = 60000000 WHERE "playwright_budget_ms" = 9000000 AND "expires_at" > now();
