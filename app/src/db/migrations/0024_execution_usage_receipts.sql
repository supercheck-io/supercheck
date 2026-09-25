CREATE TABLE "execution_usage_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "run_id" text NOT NULL,
  "event_type" text NOT NULL,
  "units" numeric(10, 4) NOT NULL,
  "metadata" jsonb,
  "billing_period_start" timestamp NOT NULL,
  "billing_period_end" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "settled_at" timestamp,
  "next_attempt_at" timestamp DEFAULT now(),
  "last_error" text,
  CONSTRAINT "execution_usage_receipts_valid_usage" CHECK (
    "event_type" IN ('playwright_execution', 'k6_execution')
    AND "units" >= 0 AND "units" <> 'NaN'::numeric
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "execution_usage_receipts_run_key"
  ON "execution_usage_receipts" ("organization_id", "event_type", "run_id");
--> statement-breakpoint
CREATE INDEX "execution_usage_receipts_pending_idx"
  ON "execution_usage_receipts" ("next_attempt_at") WHERE "settled_at" IS NULL;
