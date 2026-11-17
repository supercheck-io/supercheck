import { SubscriptionAccessDeniedError, subscriptionService } from "@/lib/services/subscription-service";

export type SubscriptionRequiredResult = { ok: false; code: "subscription_required"; error: string };

/**
 * Declaring incidents and scheduling maintenance need paid access or an active trial (the same check as resuming a
 * paused monitor). Reads, acknowledging, resolving and ending or cancelling windows stay open to a lapsed organization.
 * Self-hosted (Polar disabled) is never blocked. Null when allowed; other errors propagate.
 */
export async function lapsedWriteBlock(organizationId: string): Promise<SubscriptionRequiredResult | null> {
  try {
    await subscriptionService.blockUntilSubscribed(organizationId);
    return null;
  } catch (error) {
    if (error instanceof SubscriptionAccessDeniedError) return { ok: false, code: "subscription_required", error: error.message };
    throw error;
  }
}
