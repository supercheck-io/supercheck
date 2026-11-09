-- supercheck:no-transaction
-- The claim index for monitor alerts (columns from 0068). Every existing row has NULL outage_key, so the
-- index starts empty; building it CONCURRENTLY keeps alert_history writable while it scans the table. The
-- runner executes this file outside its migration transaction, after 0068 has committed.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "alert_history_monitor_claim_uidx" ON "alert_history" USING btree ("monitor_id","outage_key","type","alert_ordinal","provider") WHERE "alert_history"."outage_key" IS NOT NULL AND "alert_history"."alert_ordinal" IS NOT NULL;
