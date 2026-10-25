import { eq, isNull, sql } from "drizzle-orm";
import { executionUsageReceipts, usageEvents } from "@/db/schema";
import { db } from "@/utils/db";

/** Global aggregates are for server logs and the authenticated admin sync endpoint only. */
export async function getBillingReconciliationStatus() {
  const [[events], [receipts]] = await Promise.all([
    db.select({
      pendingEvents: sql<number>`count(*)::int`,
      parkedEvents: sql<number>`count(*) FILTER (WHERE ${usageEvents.billingPeriodEnd} <= now())::int`,
      oldestPendingAt: sql<Date | null>`min(${usageEvents.createdAt})`,
    }).from(usageEvents).where(eq(usageEvents.syncedToPolar, false)),
    db.select({
      pendingReceipts: sql<number>`count(*)::int`,
      parkedReceipts: sql<number>`count(*) FILTER (WHERE ${executionUsageReceipts.nextAttemptAt} IS NULL OR ${executionUsageReceipts.billingPeriodEnd} <= now())::int`,
    }).from(executionUsageReceipts).where(isNull(executionUsageReceipts.settledAt)),
  ]);
  if (!events || !receipts) throw new Error("Billing reconciliation status unavailable");
  return {
    ...events, ...receipts,
    requiresAttention: events.parkedEvents > 0 || receipts.parkedReceipts > 0 ||
      (events.oldestPendingAt !== null && Date.now() - new Date(events.oldestPendingAt).getTime() > 15 * 60_000),
  };
}
