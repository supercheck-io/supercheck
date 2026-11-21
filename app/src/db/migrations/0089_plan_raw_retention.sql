-- Raw monitor results: Pro keeps 30 days (was 7). Plus stays at 7.
-- Only the stock Pro row still at 7 days moves, so custom contracts keep their own value; a rerun changes nothing.
UPDATE "plan_limits" SET "data_retention_days" = 30, "updated_at" = now()
WHERE "plan" = 'pro' AND "data_retention_days" = 7;
