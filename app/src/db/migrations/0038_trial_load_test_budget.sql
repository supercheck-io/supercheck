-- Trial load tests are metered in virtual-user milliseconds so repeated short runs cannot exceed the allowance.
ALTER TABLE "execution_entitlements"
  ADD COLUMN "k6_budget_vu_ms" bigint NOT NULL DEFAULT 9000000,
  ADD COLUMN "k6_used_vu_ms" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "execution_entitlements"
  ADD CONSTRAINT "execution_entitlements_k6_budget_check" CHECK ("k6_budget_vu_ms" > 0 AND "k6_used_vu_ms" >= 0);
--> statement-breakpoint
ALTER TABLE "execution_reservations" ADD COLUMN "vus" integer NOT NULL DEFAULT 0;
