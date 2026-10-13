-- Preserve existing rates while allowing fractional cents; no usage is rewritten.
-- migration-safety: allow-destructive issue=#387
ALTER TABLE "overage_pricing" ALTER COLUMN "playwright_minute_price_cents"
  TYPE numeric(14, 4) USING "playwright_minute_price_cents"::numeric(14, 4);
--> statement-breakpoint
ALTER TABLE "overage_pricing" ALTER COLUMN "sre_investigation_unit_price_cents" SET DEFAULT 10;
