-- Add fractional-cent rates without changing the legacy integer column.
ALTER TABLE "overage_pricing" ADD COLUMN "k6_vu_minute_price_cents_override" numeric(14, 4);
--> statement-breakpoint
-- Reduce only complete stock price configurations; preserve custom contracts.
-- Coordinate these local rates with Polar before applying in cloud production.
UPDATE "overage_pricing" SET "k6_vu_minute_price_cents_override" = 0.5, "updated_at" = now()
WHERE "plan" = 'plus' AND "k6_vu_minute_price_cents_override" IS NULL
  AND "playwright_minute_price_cents" = 3 AND "k6_vu_minute_price_cents" = 1
  AND "ai_credit_price_cents" = 5 AND "sre_investigation_unit_price_cents" = 50;
--> statement-breakpoint
UPDATE "overage_pricing" SET "k6_vu_minute_price_cents_override" = 0.25, "updated_at" = now()
WHERE "plan" = 'pro' AND "k6_vu_minute_price_cents_override" IS NULL
  AND "playwright_minute_price_cents" = 2 AND "k6_vu_minute_price_cents" = 1
  AND "ai_credit_price_cents" = 3 AND "sre_investigation_unit_price_cents" = 50;
