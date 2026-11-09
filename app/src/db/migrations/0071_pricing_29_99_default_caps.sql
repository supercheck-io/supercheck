ALTER TABLE "billing_settings" ADD COLUMN "spending_limit_source" text DEFAULT 'plan_default' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_limits" ADD COLUMN "default_spending_limit_cents" integer;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_spending_limit_source_check" CHECK ("billing_settings"."spending_limit_source" IN ('plan_default', 'custom'));--> statement-breakpoint
-- Owners who already set or enabled a cap keep it; everyone else follows the plan default.
UPDATE "billing_settings" SET "spending_limit_source" = 'custom'
WHERE "enable_spending_limit" OR "monthly_spending_limit_cents" IS NOT NULL;--> statement-breakpoint
-- Coordinate with Polar rates and meter credits under billing maintenance.
-- Only stock Plus/Pro rows (the fields this migration changes, at their 0027 values) move;
-- custom contracts are left alone and a rerun is a no-op. Forward-only.
WITH stock AS MATERIALIZED (
  SELECT p.id AS plan_id, o.id AS price_id, p.plan
  FROM plan_limits p JOIN overage_pricing o ON o.plan = p.plan
  WHERE (p.plan = 'plus' AND p.ai_credits_included = 1000 AND p.sre_investigation_units_included = 200
         AND o.sre_investigation_unit_price_cents = 10)
     OR (p.plan = 'pro' AND p.ai_credits_included = 5000 AND p.sre_investigation_units_included = 1000
         AND o.sre_investigation_unit_price_cents = 10)
  FOR UPDATE OF p, o
), prices AS (
  UPDATE overage_pricing o SET sre_investigation_unit_price_cents = 25, updated_at = now()
  FROM stock WHERE o.id = stock.price_id RETURNING o.id
)
UPDATE plan_limits p SET
  ai_credits_included = CASE stock.plan WHEN 'plus' THEN 500 ELSE 3000 END,
  sre_investigation_units_included = CASE stock.plan WHEN 'plus' THEN 100 ELSE 500 END,
  default_spending_limit_cents = CASE stock.plan WHEN 'plus' THEN 7000 ELSE 30000 END,
  updated_at = now()
FROM stock WHERE p.id = stock.plan_id
  AND EXISTS (SELECT 1 FROM prices WHERE prices.id = stock.price_id);--> statement-breakpoint
-- The default cap does not depend on the price move: set it for any Plus/Pro row that has none,
-- so a customised row is still capped. Owners can raise or turn it off.
UPDATE plan_limits SET
  default_spending_limit_cents = CASE plan WHEN 'plus' THEN 7000 ELSE 30000 END,
  updated_at = now()
WHERE plan IN ('plus', 'pro') AND default_spending_limit_cents IS NULL;
