import { usageTracker } from "@/lib/services/usage-tracker";

type CreditKind = "ai_fix" | "ai_create" | "ai_analyze";

/**
 * Reserve a credit atomically before calling the provider (so parallel
 * requests cannot all pass a read-only check). `refund` returns it, at most
 * once, when the provider produced nothing; it is a no-op if not reserved.
 */
export async function reserveAICredit(organizationId: string, kind: CreditKind) {
  const result = await usageTracker.consumeAICredit(organizationId, kind);
  let settled = !result.allowed;
  const refund = async () => {
    if (settled) return;
    settled = true;
    try {
      await usageTracker.refundAICredit(organizationId, kind);
    } catch (error) {
      console.error("[AI credits] Refund failed:", error);
    }
  };
  return { ...result, refund };
}
