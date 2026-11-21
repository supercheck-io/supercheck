-- Raw monitor results: Plus keeps 30 days, Pro 90 days (was 7 on both).
-- Only stock rows still at 7 days move, so custom contracts keep their own values; a rerun changes nothing.
UPDATE "plan_limits" SET
  "data_retention_days" = CASE "plan" WHEN 'plus' THEN 30 ELSE 90 END,
  "updated_at" = now()
WHERE "plan" IN ('plus', 'pro') AND "data_retention_days" = 7;
