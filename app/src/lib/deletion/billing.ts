import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { executionUsageReceipts, usageEvents } from "@/db/schema";
import { getPolarConfig, isPolarEnabled, isSelfHosted } from "@/lib/feature-flags";
import { createPolarClient } from "@/lib/billing/polar-client";

/** Billing side of an organization deletion. Self-hosted and Polar-less installs: every function here is a no-op. */

export class BillingCancellationError extends Error {}

type BillingOrg = { id: string; subscriptionId: string | null; polarCustomerId: string | null };
type Executor = Pick<typeof db, "select">;

/** Any bound subscription is ended: provider states such as trialing or paused are stored locally as "none". */
export function hasCancellableSubscription(org: { subscriptionId: string | null }) {
  return !!org.subscriptionId;
}

function isAlreadyGone(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return false;
  const { statusCode, name } = error as { statusCode: number; name?: string };
  if (statusCode === 404) return true;
  // SDK errors carry the provider error code in name/error; the message also embeds the JSON body.
  const detail = `${name ?? ""} ${JSON.stringify(error)} ${(error as { message?: string }).message ?? ""}`;
  return statusCode === 403 && /AlreadyCanceledSubscription/.test(detail);
}

const client = () => {
  const config = isPolarEnabled() ? getPolarConfig() : null;
  return config ? createPolarClient({ accessToken: config.accessToken, server: config.server }) : null;
};

/** Polar invoices usage ingested before the subscription ends, so unsent usage would never be billed. */
export async function flushFinalUsage(organizationId: string, options: { strict: boolean }): Promise<void> {
  if (!isPolarEnabled()) return;
  try {
    const { polarUsageService } = await import("@/lib/services/polar-usage.service");
    const { pending } = await polarUsageService.flushOrganizationUsage(organizationId);
    if (pending > 0) throw new BillingCancellationError("Could not send the organization's final usage to the billing provider yet.");
  } catch (error) {
    if (options.strict) throw error instanceof BillingCancellationError ? error : new BillingCancellationError("Could not send the organization's final usage to the billing provider.");
    console.warn("[ORG_DELETION] Final usage flush incomplete; the usage sync keeps retrying while the organization exists:", error);
  }
}

/**
 * Usage that was never settled would be lost with the organization (both tables cascade): a completed execution whose
 * receipt is unsettled, and a usage event parked for manual reconciliation. The purge waits (and retries) rather than losing that evidence.
 */
export async function assertNoUnsettledUsage(executor: Executor, organizationId: string): Promise<void> {
  const [receipts] = await executor.select({ count: sql<number>`count(*)::int` }).from(executionUsageReceipts)
    .where(and(eq(executionUsageReceipts.organizationId, organizationId), isNull(executionUsageReceipts.settledAt)));
  const { CLOSED_USAGE_PERIOD_ERROR } = await import("@/lib/services/polar-usage.service");
  const { REJECTED_USAGE_EVENT_ERROR } = await import("@/lib/billing/reconciliation-status");
  const [parked] = await executor.select({ count: sql<number>`count(*)::int` }).from(usageEvents)
    .where(and(eq(usageEvents.organizationId, organizationId), eq(usageEvents.syncedToPolar, false),
      or(eq(usageEvents.syncError, CLOSED_USAGE_PERIOD_ERROR), eq(usageEvents.syncError, REJECTED_USAGE_EVENT_ERROR), lte(usageEvents.billingPeriodEnd, new Date()))));
  if ((receipts?.count ?? 0) > 0 || (parked?.count ?? 0) > 0) {
    throw new BillingCancellationError("The organization still has usage that was not billed (an unsettled execution or a closed or rejected billing event awaiting manual reconciliation). Settle it, then retry the purge.");
  }
}

/**
 * The subscription id to end. Normally the stored one; when checkout finished but its webhook has not stored the id yet,
 * ask the provider for the customer's active subscriptions. Only ones tagged to this organization are ended; an untagged
 * one (legacy) cannot be attributed, so the operation is refused (fail closed).
 */
async function resolveSubscriptionId(org: BillingOrg): Promise<string | null> {
  if (org.subscriptionId) return org.subscriptionId;
  const polar = org.polarCustomerId ? client() : null;
  if (!org.polarCustomerId || !polar) return null;
  try {
    const state = await polar.customers.getState(org.polarCustomerId);
    const owned = state.active_subscriptions.filter((subscription) => {
      const referenceId = (subscription.metadata as Record<string, unknown> | undefined)?.referenceId;
      if (typeof referenceId !== "string") throw new BillingCancellationError("The billing customer has a subscription that cannot be matched to this organization. Contact support.");
      return referenceId === org.id;
    });
    if (owned.length > 1) throw new BillingCancellationError("The organization has several active subscriptions. Contact support.");
    return owned[0]?.id ?? null;
  } catch (error) {
    if (error instanceof BillingCancellationError) throw error;
    console.error("[ORG_DELETION] Failed to look up the customer's subscriptions:", error);
    throw new BillingCancellationError("Could not check the organization's subscription with the billing provider. Retry once billing is available.");
  }
}

export type CancelAtPeriodEndResult = { status: "skipped" | "none" | "already" | "cancelled"; subscriptionId: string | null };

/**
 * Request time: stop renewal but keep service to the end of the paid period. Idempotent: a subscription that already
 * shows cancel-at-period-end (our earlier call, or the customer's own webhook-visible cancel) is left alone, so
 * repeated calls and concurrent pods never cancel twice.
 */
export async function cancelSubscriptionAtPeriodEnd(org: BillingOrg): Promise<CancelAtPeriodEndResult> {
  const polar = client();
  if (!polar) return { status: "skipped", subscriptionId: null };
  const subscriptionId = await resolveSubscriptionId(org);
  if (!subscriptionId) return { status: "none", subscriptionId: null };
  try {
    const current = await polar.subscriptions.get(subscriptionId);
    if (current.cancel_at_period_end || current.status === "canceled") return { status: "already", subscriptionId };
    await polar.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    return { status: "cancelled", subscriptionId };
  } catch (error) {
    if (isAlreadyGone(error)) return { status: "already", subscriptionId };
    console.error(`[ORG_DELETION] Failed to cancel subscription ${subscriptionId} at period end:`, error);
    throw new BillingCancellationError("Could not cancel the subscription with the billing provider. Nothing was changed; retry once billing is available.");
  }
}

/** Cancel-deletion: undo only a cancellation this flow made. Returns "ended" when the period already finished (the owner must resubscribe). */
export async function reinstateSubscription(org: BillingOrg): Promise<"reinstated" | "ended" | "skipped"> {
  const polar = client();
  if (!polar) return "skipped";
  const subscriptionId = await resolveSubscriptionId(org);
  if (!subscriptionId) return "ended";
  try {
    const current = await polar.subscriptions.get(subscriptionId);
    if (current.status === "canceled" && !current.cancel_at_period_end) return "ended";
    if (!current.cancel_at_period_end) return "reinstated";
    await polar.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
    return "reinstated";
  } catch (error) {
    if (isAlreadyGone(error)) return "ended";
    console.error(`[ORG_DELETION] Failed to reinstate subscription ${subscriptionId}:`, error);
    throw new BillingCancellationError("Could not reinstate the subscription with the billing provider.");
  }
}

/** Purge: end whatever is left immediately. An already-ended or missing subscription counts as done. */
export async function revokeRemainingSubscription(org: BillingOrg): Promise<{ subscriptionId: string | null }> {
  const polar = client();
  if (!polar) {
    // A billing subscription must never outlive its organization silently.
    if (hasCancellableSubscription(org) && !isSelfHosted()) throw new BillingCancellationError("Billing is not configured, so the subscription cannot be cancelled");
    return { subscriptionId: null };
  }
  const subscriptionId = await resolveSubscriptionId(org);
  if (!subscriptionId) return { subscriptionId: null };
  try {
    await polar.subscriptions.revoke(subscriptionId);
  } catch (error) {
    if (isAlreadyGone(error)) return { subscriptionId };
    console.error(`[ORG_DELETION] Failed to revoke subscription ${subscriptionId}:`, error);
    throw new BillingCancellationError("Could not cancel the subscription with the billing provider. Organization records are unchanged; the purge retries.");
  }
  return { subscriptionId };
}
