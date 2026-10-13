-- Coordinate with Polar rates and meter credits under billing maintenance.
-- Discount only complete previous stock contracts; preserve custom plans/rates.
-- Forward-only: rollback requires a reviewed migration and matching Polar changes.
WITH stock AS MATERIALIZED (
  SELECT p.id AS plan_id, o.id AS price_id, p.plan
  FROM plan_limits p JOIN overage_pricing o ON o.plan = p.plan
  WHERE (to_jsonb(p) @> '{
    "plan": "plus",
    "max_monitors": 25,
    "min_check_interval_minutes": 1,
    "playwright_minutes_included": 3000,
    "k6_vu_minutes_included": 20000,
    "ai_credits_included": 100,
    "sre_investigation_units_included": 25,
    "running_capacity": 5,
    "queued_capacity": 50,
    "max_team_members": 5,
    "max_organizations": 1,
    "max_projects": 10,
    "max_status_pages": 3,
    "max_status_page_subscribers": 500,
    "custom_domains": true,
    "sso_enabled": true,
    "data_retention_days": 7,
    "aggregated_data_retention_days": 30,
    "job_data_retention_days": 30
}'::jsonb AND o.playwright_minute_price_cents = 3 AND o.k6_vu_minute_price_cents = 1 AND o.k6_vu_minute_price_cents_override = 0.5 AND o.ai_credit_price_cents = 5 AND o.sre_investigation_unit_price_cents = 50)
    OR (to_jsonb(p) @> '{
    "plan": "pro",
    "max_monitors": 100,
    "min_check_interval_minutes": 1,
    "playwright_minutes_included": 10000,
    "k6_vu_minutes_included": 75000,
    "ai_credits_included": 300,
    "sre_investigation_units_included": 100,
    "running_capacity": 10,
    "queued_capacity": 100,
    "max_team_members": 25,
    "max_organizations": 1,
    "max_projects": 50,
    "max_status_pages": 15,
    "max_status_page_subscribers": 5000,
    "custom_domains": true,
    "sso_enabled": true,
    "data_retention_days": 7,
    "aggregated_data_retention_days": 90,
    "job_data_retention_days": 90
}'::jsonb AND o.playwright_minute_price_cents = 2 AND o.k6_vu_minute_price_cents = 1 AND o.k6_vu_minute_price_cents_override = 0.25 AND o.ai_credit_price_cents = 3 AND o.sre_investigation_unit_price_cents = 50)
  FOR UPDATE OF p, o
), prices AS (
  UPDATE overage_pricing o SET
    playwright_minute_price_cents = CASE stock.plan WHEN 'plus' THEN 1 ELSE 0.5 END,
    k6_vu_minute_price_cents_override = CASE stock.plan WHEN 'plus' THEN 0.2 ELSE 0.1 END,
    sre_investigation_unit_price_cents = 10, updated_at = now()
  FROM stock WHERE o.id = stock.price_id RETURNING o.id
)
UPDATE plan_limits p SET
  max_monitors = CASE stock.plan WHEN 'plus' THEN 50 ELSE 200 END,
  k6_vu_minutes_included = CASE stock.plan WHEN 'plus' THEN 30000 ELSE 100000 END,
  ai_credits_included = CASE stock.plan WHEN 'plus' THEN 1000 ELSE 5000 END,
  sre_investigation_units_included = CASE stock.plan WHEN 'plus' THEN 200 ELSE 1000 END,
  max_status_pages = CASE stock.plan WHEN 'plus' THEN 5 ELSE 20 END,
  max_status_page_subscribers = CASE stock.plan WHEN 'plus' THEN 1000 ELSE 10000 END,
  updated_at = now()
FROM stock WHERE p.id = stock.plan_id
  AND EXISTS (SELECT 1 FROM prices WHERE prices.id = stock.price_id);
